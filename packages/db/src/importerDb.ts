/**
 * Motor de importación con relaciones: genera un ImportSchema desde una
 * tabla de la BD y resuelve las FKs automáticamente al importar.
 *
 * Ejemplo: importar en `ordenes_trabajo` con la columna `cliente_id`
 * (FK → clientes). El campo se marca como relación y al importar se
 * busca el cliente por `clientes.nombre`; si no existe, se crea.
 * Lo mismo para `vehiculo_id` (por patente) y `mecanico_id` (por nombre).
 */

import type { ImportSchema, RawValue, TargetField } from '@importador/core';
import type {
  DbAdapter,
  DbImportOptions,
  DbImportResult,
  DbTable,
  TablaImportable,
} from './types.js';

// ── Mapeo de tipos SQL → tipos del importador ─────────────────

const TIPO_IMPORTADOR: Array<[RegExp, TargetField['tipo']]> = [
  [/^smallint|^integer|^bigint/, 'entero'],
  [/^numeric|^decimal|^real|^double/, 'numero'],
  [/^timestamp|^date/, 'fecha'],
  [/^boolean/, 'booleano'],
];

export function tipoImportador(sqlType: string): TargetField['tipo'] {
  for (const [re, tipo] of TIPO_IMPORTADOR) {
    if (re.test(sqlType)) return tipo;
  }
  return 'texto';
}

// ── Generador de schema desde tabla ───────────────────────────

/**
 * Construye el ImportSchema de una tabla: cada columna insertable es un
 * campo; las columnas FK se marcan con `relacion` para que el sink las
 * resuelva contra la tabla referenciada.
 */
export function schemaDesdeTabla(
  tabla: DbTable,
  opts: DbImportOptions = {},
): TablaImportable {
  const relacionadas = new Set<string>();
  const campos: TargetField[] = [];

  for (const col of tabla.columnas) {
    if (col.generada || col.pk) continue; // no se insertan
    const fk = tabla.fks.find((f) => f.columna === col.nombre);

    // Columna FK: se resuelve por la clave natural de la tabla referenciada
    if (fk) {
      const resolucion =
        opts.resolucion?.[`${tabla.nombre}.${col.nombre}`] ??
        fk.columna_resolucion ??
        'id';
      relacionadas.add(fk.tabla_ref);
      campos.push({
        id: col.nombre,
        label: `${col.nombre} (→ ${fk.tabla_ref}.${resolucion})`,
        tipo: 'texto',
        requerido: col.not_null,
        alias: [fk.tabla_ref, resolucion, `${fk.tabla_ref} ${resolucion}`],
        descripcion: `Se enlaza con ${fk.tabla_ref} buscando por "${resolucion}" (se crea si no existe)`,
        relacion: { tabla: fk.tabla_ref, columna: resolucion },
      });
      continue;
    }

    // Columna normal
    campos.push({
      id: col.nombre,
      label: col.nombre,
      tipo: tipoImportador(col.tipo),
      requerido: col.not_null && !col.pk,
      alias: [col.nombre],
    });
  }

  const schema: ImportSchema = {
    nombre: tabla.nombre,
    campos,
  };

  return { tabla, schema, relacionadas: [...relacionadas] };
}

// ── Sink con resolución de relaciones ─────────────────────────

/** Cache de resoluciones: "tabla|columna|valor" → id (o null = no existe). */
type ResolucionCache = Map<string, string | null>;

function cacheKey(tabla: string, columna: string, valor: string): string {
  return `${tabla}|${columna}|${valor.toLowerCase().trim()}`;
}

/**
 * Resuelve una FK: busca en la tabla referenciada por la columna de
 * resolución; si no existe y `crearRelacionados`, crea el registro
 * (resolviendo a su vez SUS FKs, recursivamente).
 *
 * `fkResueltos` acumula los ids ya resueltos en la fila actual
 * (tabla_ref → id): si un padre que se crea tiene una FK a la MISMA
 * tabla, reutiliza el id (p.ej. al crear un vehículo desde una OT, el
 * vehículo hereda el cliente_id ya resuelto para la OT).
 */
async function resolverRelacion(
  adapter: DbAdapter,
  fk: { tabla_ref: string; columna_resolucion?: string },
  valor: unknown,
  opts: DbImportOptions,
  cache: ResolucionCache,
  enProceso: string[],
  fkResueltos: Map<string, string>,
): Promise<string | null> {
  const v = String(valor ?? '').trim();
  if (!v) return null;

  const columna = fk.columna_resolucion ?? 'id';
  const key = cacheKey(fk.tabla_ref, columna, v);
  if (cache.has(key)) {
    const cached = cache.get(key);
    if (cached) fkResueltos.set(fk.tabla_ref, cached);
    return cached ?? null;
  }

  // Detectar ciclos (A→B→A) durante la creación recursiva
  const camino = `${fk.tabla_ref}#${columna}#${v.toLowerCase()}`;
  if (enProceso.includes(camino)) {
    throw new Error(`Ciclo de relaciones al crear ${fk.tabla_ref} (${columna}=${v})`);
  }

  const id = await adapter.buscarId(fk.tabla_ref, columna, v);
  if (id) {
    cache.set(key, id);
    fkResueltos.set(fk.tabla_ref, id);
    return id;
  }

  if (opts.crearRelacionados === false) {
    cache.set(key, null);
    return null;
  }

  // Crear el registro padre: necesitamos su esquema.
  // Cache: leerEsquema() se llama UNA vez por importación (no por fila),
  // porque el mismo objeto `opts` viaja por todas las filas del lote.
  let schema = opts.esquema;
  if (!schema) {
    schema = await adapter.leerEsquema();
    opts.esquema = schema;
  }
  const padre = schema.find((t) => t.nombre === fk.tabla_ref);
  if (!padre) {
    cache.set(key, null);
    return null;
  }

  // El valor que tenemos es la clave natural → va en la columna de resolución
  const filaPadre: Record<string, unknown> = { [columna]: v };
  const nuevoId = await insertarConRelaciones(adapter, padre, filaPadre, opts, cache, [...enProceso, camino], fkResueltos);
  cache.set(key, nuevoId);
  fkResueltos.set(fk.tabla_ref, nuevoId);
  return nuevoId;
}

/**
 * Inserta una fila resolviendo sus FKs: para cada columna FK del esquema,
 * si la fila trae un valor para esa columna, se resuelve (busca o crea el
 * padre); el valor resultante es el id del padre.
 *
 * `fkResueltos` (tabla_ref → id) permite reutilizar ids ya resueltos en la
 * fila: si esta fila ya enlazó un cliente y otra FK del padre creado apunta
 * a la misma tabla, se reutiliza sin volver a buscar.
 */
export async function insertarConRelaciones(
  adapter: DbAdapter,
  tabla: DbTable,
  fila: Record<string, unknown>,
  opts: DbImportOptions = {},
  cache: ResolucionCache = new Map(),
  enProceso: string[] = [],
  fkResueltos: Map<string, string> = new Map(),
): Promise<string> {
  const payload: Record<string, unknown> = {};
  const resolucionOverrides = opts.resolucion ?? {};
  const fkResueltosLocales = new Map(fkResueltos);

  for (const col of tabla.columnas) {
    if (col.generada || col.pk) continue;
    const fk = tabla.fks.find((f) => f.columna === col.nombre);

    // Columnas FK: primero comprobar si ya resolvimos la tabla referenciada
    // en la fila actual (propagación: el vehículo creado desde una OT hereda
    // el cliente_id ya resuelto aunque su fila no lo traiga).
    if (fk) {
      const yaResuelto = fkResueltosLocales.get(fk.tabla_ref);
      if (yaResuelto) {
        payload[col.nombre] = yaResuelto;
        continue;
      }
      if (!(col.nombre in fila)) continue;
      const valor = fila[col.nombre];
      if (valor === null || valor === undefined || valor === '') continue;
      const resolucion =
        resolucionOverrides[`${tabla.nombre}.${col.nombre}`] ??
        fk.columna_resolucion ??
        'id';
      const idPadre = await resolverRelacion(
        adapter,
        { tabla_ref: fk.tabla_ref, columna_resolucion: resolucion },
        valor,
        opts,
        cache,
        enProceso,
        fkResueltosLocales,
      );
      if (idPadre) payload[col.nombre] = idPadre;
      continue;
    }

    // Columna normal
    if (!(col.nombre in fila)) continue;
    const valor = fila[col.nombre];
    if (valor === null || valor === undefined || valor === '') continue;
    // Transformación personalizada si existe
    const fn = opts.transform?.[`${tabla.nombre}.${col.nombre}`];
    payload[col.nombre] = fn ? fn(valor) : valor;
  }

  return adapter.insertar(tabla.nombre, payload);
}

/**
 * Importa un lote de filas (ya transformadas por el ImportStepper, con
 * claves = nombres de columna) en la tabla destino, resolviendo FKs.
 *
 * Si `opts.dedupe` trae columnas clave, cada fila se compara contra lo ya
 * existente: si coincide en TODAS las claves se omite (o se actualiza si
 * `actualizarDuplicados`), evitando llenar la BD de duplicados.
 */
export async function importarEnTabla(
  adapter: DbAdapter,
  tabla: DbTable,
  filas: Array<Record<string, unknown>>,
  opts: DbImportOptions = {},
): Promise<DbImportResult> {
  const resumen: DbImportResult = {
    insertados: 0,
    omitidos: 0,
    duplicados: 0,
    actualizados: 0,
    errores: 0,
    detalle: [],
    ids: [],
  };
  const cache: ResolucionCache = new Map();
  const max = opts.maxRows ?? 10_000;
  const lote = filas.slice(0, max);
  const clavesDedupe = opts.dedupe ?? [];

  for (const fila of lote) {
    try {
      // Dedupe: si la fila trae valores para todas las columnas clave,
      // buscar un registro existente que coincida en todas (AND).
      if (clavesDedupe.length > 0) {
        const claves: Record<string, unknown> = {};
        let completas = true;
        for (const col of clavesDedupe) {
          const v = fila[col];
          if (v === null || v === undefined || v === '') {
            completas = false;
            break;
          }
          claves[col] = v;
        }
        if (completas && adapter.buscarDuplicado) {
          const existente = await adapter.buscarDuplicado(tabla.nombre, claves);
          if (existente) {
            if (opts.actualizarDuplicados && adapter.actualizar) {
              const payload: Record<string, unknown> = {};
              for (const col of tabla.columnas) {
                if (col.generada || col.pk) continue;
                const fk = tabla.fks.find((f) => f.columna === col.nombre);
                if (fk) continue; // las FKs no se tocan en el update por clave natural
                if (!(col.nombre in fila)) continue;
                const valor = fila[col.nombre];
                if (valor === null || valor === undefined || valor === '') continue;
                const fn = opts.transform?.[`${tabla.nombre}.${col.nombre}`];
                payload[col.nombre] = fn ? fn(valor) : valor;
              }
              await adapter.actualizar(tabla.nombre, existente, payload);
              resumen.actualizados++;
              resumen.omitidos++;
              resumen.ids.push(existente);
              continue;
            }
            resumen.duplicados++;
            resumen.omitidos++;
            resumen.ids.push(existente);
            continue;
          }
        }
      }

      const id = await insertarConRelaciones(adapter, tabla, fila, opts, cache);
      resumen.insertados++;
      resumen.ids.push(id);
    } catch (e: any) {
      resumen.errores++;
      resumen.detalle.push(`${e.message}`);
    }
  }
  return resumen;
}
