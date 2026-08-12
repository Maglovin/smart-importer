/**
 * Adaptador Supabase: lee el esquema vía un RPC (`schema_importable`)
 * y hace búsquedas/inserciones por REST.
 *
 * El RPC lo provee cada app (migración SQL) — devuelve jsonb con:
 *   [{ tabla, columnas: [{nombre, tipo, not_null, pk, generada}],
 *      fks: [{nombre, columna, tabla_ref, columna_ref}] }]
 */

import type { DbAdapter, DbColumn, DbForeignKey, DbSchema, DbTable } from '../types.js';

export interface SupabaseLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  from(tabla: string): SupabaseQuery;
}

export interface SupabaseQuery {
  select(columns: string): SupabaseQuery;
  eq(col: string, val: unknown): SupabaseQuery;
  ilike(col: string, val: string): SupabaseQuery;
  limit(n: number): SupabaseQuery;
  single(): Promise<{ data: unknown; error: { message: string } | null }>;
  update(fila: Record<string, unknown>): SupabaseQuery;
  insert(fila: Record<string, unknown>): SupabaseQuery;
}

/** Heurística: primera columna no-PK, no generada, de tipo texto — la
 *  "clave natural" más probable (nombre, patente, email…). */
const TIPOS_TEXTO = ['text', 'character varying', 'varchar', 'char', 'citext'];

function claveNatural(table: DbTable): string | null {
  const col = table.columnas.find(
    (c) =>
      !c.pk &&
      !c.generada &&
      TIPOS_TEXTO.some((t) => c.tipo.startsWith(t)) &&
      !['created_at', 'updated_at'].includes(c.nombre),
  );
  return col?.nombre ?? null;
}

/** Fila cruda del jsonb del RPC schema_importable (antes de validar). */
interface SchemaRowRaw {
  tabla?: string;
  columnas?: DbColumn[];
  fks?: Array<{
    nombre?: string;
    columna?: string;
    tabla_ref?: string;
    columna_ref?: string;
  }>;
}

/** Convierte el jsonb crudo del RPC en DbSchema tipado. */
export function parseSchemaRaw(raw: unknown): DbSchema {
  if (!Array.isArray(raw)) return [];
  const tablas: DbTable[] = raw.map((t) => {
    const row = (t ?? {}) as SchemaRowRaw;
    return {
      nombre: row.tabla ?? '',
      columnas: (row.columnas ?? []) as DbColumn[],
      fks: (row.fks ?? []).map((fk) => ({
        nombre: fk.nombre ?? '',
        columna: fk.columna ?? '',
        tabla_ref: fk.tabla_ref ?? '',
        columna_ref: fk.columna_ref ?? '',
      })) as DbForeignKey[],
    };
  });
  // Segundo pase: asignar clave natural a cada FK que apunte a una tabla
  // conocida. NO se puede hacer dentro del map() anterior: ahí `tablas`
  // aún no está inicializada (TDZ) y lanza "Cannot access 'tablas'
  // before initialization".
  for (const table of tablas) {
    for (const fk of table.fks) {
      const ref = tablas.find((x) => x.nombre === fk.tabla_ref);
      fk.columna_resolucion = ref ? (claveNatural(ref) ?? 'id') : 'id';
    }
  }
  return tablas;
}

/** Adaptador Supabase (RPC schema_importable + REST). */
export function supabaseAdapter(sb: SupabaseLike, rpcNombre = 'schema_importable'): DbAdapter {
  return {
    async leerEsquema(): Promise<DbSchema> {
      const { data, error } = await sb.rpc(rpcNombre);
      if (error) throw new Error(`No se pudo leer el esquema: ${error.message}`);
      return parseSchemaRaw(data);
    },

    async buscarId(tabla, columna, valor): Promise<string | null> {
      const v = String(valor ?? '').trim();
      if (!v) return null;
      const { data, error } = await sb
        .from(tabla)
        .select('id')
        .ilike(columna, v)
        .limit(1)
        .single()
        // el single() lanza error si no hay filas → tratarlo como "no existe"
        .catch(() => ({ data: null, error: null }));
      if (error || !data) return null;
      return (data as { id: string }).id;
    },

    async insertar(tabla, fila): Promise<string> {
      const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
      if (error) throw new Error(`${tabla}: ${error.message}`);
      return (data as { id: string }).id;
    },

    async buscarDuplicado(tabla, claves): Promise<string | null> {
      // Coincidencia AND case-insensitive sobre todas las claves
      let query = sb.from(tabla).select('id');
      for (const [col, val] of Object.entries(claves)) {
        query = query.ilike(col, String(val));
      }
      const { data, error } = await query
        .limit(1)
        .single()
        // single() lanza error si no hay filas → "no existe"
        .catch(() => ({ data: null, error: null }));
      if (error || !data) return null;
      return (data as { id: string }).id;
    },

    async actualizar(tabla, id, fila): Promise<void> {
      const { error } = await sb.from(tabla).update(fila).eq('id', id).select('id').single();
      if (error) throw new Error(`${tabla}: ${error.message}`);
    },
  };
}
