/**
 * Tests del motor de importación con relaciones (@importador/db).
 * Usa un adaptador mock en memoria (sin Supabase).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemaDesdeTabla,
  importarEnTabla,
  insertarConRelaciones,
  tipoImportador,
  parseSchemaRaw,
} from '../dist/index.js';

// ── Esquema de ejemplo (taller) ────────────────────────────────

const esquemaTaller = [
  {
    nombre: 'clientes',
    columnas: [
      { nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true },
      { nombre: 'nombre', tipo: 'text', not_null: true, pk: false, generada: false },
      { nombre: 'telefono', tipo: 'text', not_null: false, pk: false, generada: false },
    ],
    fks: [],
  },
  {
    nombre: 'vehiculos',
    columnas: [
      { nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true },
      { nombre: 'cliente_id', tipo: 'uuid', not_null: true, pk: false, generada: false },
      { nombre: 'patente', tipo: 'text', not_null: true, pk: false, generada: false },
      { nombre: 'marca', tipo: 'text', not_null: false, pk: false, generada: false },
    ],
    fks: [
      {
        nombre: 'vehiculos_cliente_id_fkey',
        columna: 'cliente_id',
        tabla_ref: 'clientes',
        columna_ref: 'id',
        columna_resolucion: 'nombre',
      },
    ],
  },
  {
    nombre: 'ordenes_trabajo',
    columnas: [
      { nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true },
      { nombre: 'cliente_id', tipo: 'uuid', not_null: true, pk: false, generada: false },
      { nombre: 'vehiculo_id', tipo: 'uuid', not_null: true, pk: false, generada: false },
      { nombre: 'descripcion', tipo: 'text', not_null: false, pk: false, generada: false },
      { nombre: 'total_final', tipo: 'numeric', not_null: false, pk: false, generada: false },
      { nombre: 'created_at', tipo: 'timestamp', not_null: true, pk: false, generada: true },
    ],
    fks: [
      {
        nombre: 'ot_cliente_fkey',
        columna: 'cliente_id',
        tabla_ref: 'clientes',
        columna_ref: 'id',
        columna_resolucion: 'nombre',
      },
      {
        nombre: 'ot_vehiculo_fkey',
        columna: 'vehiculo_id',
        tabla_ref: 'vehiculos',
        columna_ref: 'id',
        columna_resolucion: 'patente',
      },
    ],
  },
];

// ── Adaptador mock ─────────────────────────────────────────────

class MockAdapter {
  tablas;
  nextId = 1;
  /** Contador de llamadas a leerEsquema (para verificar el cache). */
  llamadasEsquema = 0;

  constructor() {
    this.tablas = new Map();
    for (const t of esquemaTaller) this.tablas.set(t.nombre, new Map());
  }

  async leerEsquema() {
    this.llamadasEsquema++;
    return JSON.parse(JSON.stringify(esquemaTaller));
  }

  async buscarId(tabla, columna, valor) {
    const filas = this.tablas.get(tabla) ?? new Map();
    const v = String(valor ?? '')
      .trim()
      .toLowerCase();
    for (const row of filas.values()) {
      if (
        String(row[columna] ?? '')
          .trim()
          .toLowerCase() === v
      )
        return row.id;
    }
    return null;
  }

  async insertar(tabla, fila) {
    const filas = this.tablas.get(tabla);
    // Validar NOT NULL (paridad con Supabase): columnas obligatorias no generadas
    const def = esquemaTaller.find((t) => t.nombre === tabla);
    if (def) {
      for (const col of def.columnas) {
        if (col.not_null && !col.pk && !col.generada && fila[col.nombre] === undefined) {
          throw new Error(`${tabla}.${col.nombre} viola NOT NULL`);
        }
      }
    }
    const id = `id-${this.nextId++}`;
    filas.set(id, { ...fila, id });
    return id;
  }

  async buscarDuplicado(tabla, claves) {
    const filas = this.tablas.get(tabla) ?? new Map();
    for (const row of filas.values()) {
      const coincide = Object.entries(claves).every(
        ([col, val]) =>
          String(row[col] ?? '')
            .trim()
            .toLowerCase() ===
          String(val ?? '')
            .trim()
            .toLowerCase(),
      );
      if (coincide) return row.id;
    }
    return null;
  }

  async actualizar(tabla, id, fila) {
    const filas = this.tablas.get(tabla);
    const existente = filas.get(id);
    if (!existente) throw new Error(`${tabla}: no existe id ${id}`);
    filas.set(id, { ...existente, ...fila });
  }

  conteo(tabla) {
    return this.tablas.get(tabla)?.size ?? 0;
  }
}

// ── Tests ──────────────────────────────────────────────────────

test('tipoImportador: mapea tipos SQL', () => {
  assert.equal(tipoImportador('integer'), 'entero');
  assert.equal(tipoImportador('numeric(10,2)'), 'numero');
  assert.equal(tipoImportador('timestamp with time zone'), 'fecha');
  assert.equal(tipoImportador('boolean'), 'booleano');
  assert.equal(tipoImportador('text'), 'texto');
});

test('schemaDesdeTabla: excluye PK/generadas y marca FKs como relación', () => {
  const ot = esquemaTaller.find((t) => t.nombre === 'ordenes_trabajo');
  const { schema, relacionadas } = schemaDesdeTabla(ot);

  // created_at es generada → no aparece; id (pk) → no aparece
  assert.ok(!schema.campos.some((c) => c.id === 'id'));
  assert.ok(!schema.campos.some((c) => c.id === 'created_at'));

  const clienteField = schema.campos.find((c) => c.id === 'cliente_id');
  assert.deepEqual(clienteField.relacion, { tabla: 'clientes', columna: 'nombre' });
  assert.equal(clienteField.tipo, 'texto');
  assert.ok(clienteField.requerido);

  const vehField = schema.campos.find((c) => c.id === 'vehiculo_id');
  assert.deepEqual(vehField.relacion, { tabla: 'vehiculos', columna: 'patente' });

  const descField = schema.campos.find((c) => c.id === 'descripcion');
  assert.equal(descField.relacion, undefined);

  assert.deepEqual(relacionadas.sort(), ['clientes', 'vehiculos']);
});

test('importarEnTabla: resuelve FKs y crea padres automáticamente', async () => {
  const adapter = new MockAdapter();
  const ot = esquemaTaller.find((t) => t.nombre === 'ordenes_trabajo');

  const res = await importarEnTabla(adapter, ot, [
    {
      cliente_id: 'JUAN PEREZ',
      vehiculo_id: 'AB123CD',
      descripcion: 'CAMBIO CORREA',
      total_final: 135.22,
    },
    { cliente_id: 'JUAN PEREZ', vehiculo_id: 'AB123CD', descripcion: 'FRENOS', total_final: 88.5 },
    {
      cliente_id: 'MARIA LOPEZ',
      vehiculo_id: 'CD456EF',
      descripcion: 'SERVICIO',
      total_final: 250,
    },
  ]);

  assert.equal(res.insertados, 3);
  assert.equal(res.errores, 0);

  // Se crearon 2 clientes (JUAN y MARIA, JUAN reutilizado) y 2 vehículos
  assert.equal(adapter.conteo('clientes'), 2);
  assert.equal(adapter.conteo('vehiculos'), 2);
  assert.equal(adapter.conteo('ordenes_trabajo'), 3);

  // Los ids insertados en OT apuntan a los padres creados
  const clienteJuan = [...adapter.tablas.get('clientes').values()].find(
    (c) => c.nombre === 'JUAN PEREZ',
  );
  const vehAb = [...adapter.tablas.get('vehiculos').values()].find((v) => v.patente === 'AB123CD');
  const ot1 = [...adapter.tablas.get('ordenes_trabajo').values()][0];
  assert.equal(ot1.cliente_id, clienteJuan.id);
  assert.equal(ot1.vehiculo_id, vehAb.id);
  // El vehículo hereda el cliente del que lo creó
  assert.equal(vehAb.cliente_id, clienteJuan.id);
});

test('crearRelacionados=false: no crea padres, omitidos con error', async () => {
  const adapter = new MockAdapter();
  const ot = esquemaTaller.find((t) => t.nombre === 'ordenes_trabajo');

  const res = await importarEnTabla(
    adapter,
    ot,
    [{ cliente_id: 'NADIE EXISTE', vehiculo_id: 'XX999', descripcion: 'X' }],
    { crearRelacionados: false },
  );

  assert.equal(res.insertados, 0);
  assert.equal(adapter.conteo('clientes'), 0);
  // cliente_id no resuelto → no se inserta la OT (FK not null falla o se omite)
  assert.ok(res.errores > 0 || res.insertados === 0);
});

test('insertarConRelaciones: respeta transformaciones por columna', async () => {
  const adapter = new MockAdapter();
  const clientes = esquemaTaller.find((t) => t.nombre === 'clientes');

  const id = await insertarConRelaciones(
    adapter,
    clientes,
    { nombre: '  juan  ' },
    {
      transform: { 'clientes.nombre': (v) => String(v).trim().toUpperCase() },
    },
  );

  const fila = adapter.tablas.get('clientes').get(id);
  assert.equal(fila.nombre, 'JUAN');
});

test('parseSchemaRaw: parsea el jsonb del RPC y resuelve claves naturales (regresión TDZ)', () => {
  // Simula la salida exacta del RPC schema_importable (con FKs).
  // Antes del fix, el map() referenciaba `tablas` dentro de su propio
  // inicializador → "Cannot access 'tablas' before initialization".
  const raw = [
    {
      tabla: 'clientes',
      orden: 1,
      columnas: [
        { nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true, ordinal: 1 },
        { nombre: 'nombre', tipo: 'text', not_null: true, pk: false, generada: false, ordinal: 2 },
        {
          nombre: 'telefono',
          tipo: 'text',
          not_null: false,
          pk: false,
          generada: false,
          ordinal: 3,
        },
      ],
      fks: [],
    },
    {
      tabla: 'vehiculos',
      orden: 2,
      columnas: [
        { nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true, ordinal: 1 },
        {
          nombre: 'cliente_id',
          tipo: 'uuid',
          not_null: true,
          pk: false,
          generada: false,
          ordinal: 2,
        },
        { nombre: 'patente', tipo: 'text', not_null: true, pk: false, generada: false, ordinal: 3 },
        { nombre: 'marca', tipo: 'text', not_null: false, pk: false, generada: false, ordinal: 4 },
      ],
      fks: [
        {
          nombre: 'vehiculos_cliente_id_fkey',
          columna: 'cliente_id',
          tabla_ref: 'clientes',
          columna_ref: 'id',
        },
      ],
    },
  ];

  const schema = parseSchemaRaw(raw);
  assert.equal(schema.length, 2);

  const vehiculos = schema.find((t) => t.nombre === 'vehiculos');
  assert.equal(vehiculos.fks.length, 1);
  // La FK a clientes se resuelve por su clave natural (nombre)
  assert.equal(vehiculos.fks[0].columna_resolucion, 'nombre');

  // FK a tabla desconocida → 'id'
  const rawConFkDesconocida = [
    {
      tabla: 'a',
      columnas: [{ nombre: 'id', tipo: 'uuid', not_null: true, pk: true, generada: true }],
      fks: [{ nombre: 'a_b_fkey', columna: 'b_id', tabla_ref: 'no_existe', columna_ref: 'id' }],
    },
  ];
  const schema2 = parseSchemaRaw(rawConFkDesconocida);
  assert.equal(schema2[0].fks[0].columna_resolucion, 'id');
});

test('dedupe: omite filas con clave repetida (no llena la BD de duplicados)', async () => {
  const adapter = new MockAdapter();
  const vehiculos = esquemaTaller.find((t) => t.nombre === 'vehiculos');

  const res = await importarEnTabla(
    adapter,
    vehiculos,
    [
      { patente: 'AB123CD', marca: 'RENAULT', cliente_id: 'JUAN PEREZ' },
      { patente: 'ab123cd', marca: 'RENAULT KANGOO', cliente_id: 'JUAN PEREZ' }, // duplicado (case-insensitive)
      { patente: 'CD456EF', marca: 'FORD', cliente_id: 'MARIA LOPEZ' },
    ],
    { dedupe: ['patente'] },
  );

  assert.equal(res.insertados, 2);
  assert.equal(res.duplicados, 1);
  assert.equal(res.omitidos, 1);
  assert.equal(adapter.conteo('vehiculos'), 2);

  // El vehículo se creó UNA vez (la segunda fila se saltó)
  const patentes = [...adapter.tablas.get('vehiculos').values()].map((v) => v.patente);
  assert.deepEqual(patentes.sort(), ['AB123CD', 'CD456EF']);
});

test('dedupe: clave incompleta en la fila → se inserta igual (no puede comparar)', async () => {
  const adapter = new MockAdapter();
  const clientes = esquemaTaller.find((t) => t.nombre === 'clientes');

  const res = await importarEnTabla(
    adapter,
    clientes,
    [
      { nombre: 'JUAN PEREZ', telefono: '' }, // teléfono vacío → la clave no está completa
      { nombre: 'MARIA LOPEZ', telefono: '' },
    ],
    { dedupe: ['telefono'] },
  );

  // Sin clave completa no hay comparación posible → se insertan ambas
  assert.equal(res.insertados, 2);
  assert.equal(res.duplicados, 0);
  assert.equal(adapter.conteo('clientes'), 2);
});

test('dedupe + actualizarDuplicados: actualiza en vez de omitir (upsert por clave)', async () => {
  const adapter = new MockAdapter();
  const vehiculos = esquemaTaller.find((t) => t.nombre === 'vehiculos');

  const res = await importarEnTabla(
    adapter,
    vehiculos,
    [
      { patente: 'AB123CD', marca: 'RENAULT', cliente_id: 'JUAN PEREZ' },
      { patente: 'AB123CD', marca: 'RENAULT KANGOO', cliente_id: 'JUAN PEREZ' }, // duplicado → actualiza
    ],
    { dedupe: ['patente'], actualizarDuplicados: true },
  );

  assert.equal(res.insertados, 1);
  assert.equal(res.actualizados, 1);
  assert.equal(adapter.conteo('vehiculos'), 1);

  // La marca quedó actualizada a la última versión
  const veh = [...adapter.tablas.get('vehiculos').values()][0];
  assert.equal(veh.marca, 'RENAULT KANGOO');
});

test('dedupe multi-columna: requiere coincidencia en TODAS las claves', async () => {
  const adapter = new MockAdapter();
  const clientes = esquemaTaller.find((t) => t.nombre === 'clientes');

  const res = await importarEnTabla(
    adapter,
    clientes,
    [
      { nombre: 'JUAN PEREZ', telefono: '3415551234' },
      { nombre: 'JUAN PEREZ', telefono: '3415559999' }, // mismo nombre, otro teléfono → NO duplicado
      { nombre: 'juan perez', telefono: '3415551234' }, // duplicado exacto (case-insensitive)
    ],
    { dedupe: ['nombre', 'telefono'] },
  );

  assert.equal(res.insertados, 2);
  assert.equal(res.duplicados, 1);
  assert.equal(adapter.conteo('clientes'), 2);
});

test('cache: leerEsquema se llama UNA vez por importación (no por fila)', async () => {
  const adapter = new MockAdapter();
  const ot = esquemaTaller.find((t) => t.nombre === 'ordenes_trabajo');

  // 5 filas con 5 clientes+vehículos NUEVOS: cada uno dispara creación de
  // padre, que antes llamaba a leerEsquema() por cada uno.
  const filas = ['A', 'B', 'C', 'D', 'E'].map((c) => ({
    cliente_id: `CLIENTE ${c}`,
    vehiculo_id: `ZZ${c}999`,
    descripcion: 'X',
  }));
  const res = await importarEnTabla(adapter, ot, filas);

  assert.equal(res.insertados, 5);
  assert.equal(adapter.conteo('clientes'), 5);
  assert.equal(adapter.conteo('vehiculos'), 5);
  // Solo 1 llamada a leerEsquema para todo el lote
  assert.equal(adapter.llamadasEsquema, 1);
});
