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
    fks: [{ nombre: 'vehiculos_cliente_id_fkey', columna: 'cliente_id', tabla_ref: 'clientes', columna_ref: 'id', columna_resolucion: 'nombre' }],
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
      { nombre: 'ot_cliente_fkey', columna: 'cliente_id', tabla_ref: 'clientes', columna_ref: 'id', columna_resolucion: 'nombre' },
      { nombre: 'ot_vehiculo_fkey', columna: 'vehiculo_id', tabla_ref: 'vehiculos', columna_ref: 'id', columna_resolucion: 'patente' },
    ],
  },
];

// ── Adaptador mock ─────────────────────────────────────────────

class MockAdapter {
  tablas;
  nextId = 1;

  constructor() {
    this.tablas = new Map();
    for (const t of esquemaTaller) this.tablas.set(t.nombre, new Map());
  }

  async leerEsquema() {
    return JSON.parse(JSON.stringify(esquemaTaller));
  }

  async buscarId(tabla, columna, valor) {
    const filas = this.tablas.get(tabla) ?? new Map();
    const v = String(valor ?? '').trim().toLowerCase();
    for (const row of filas.values()) {
      if (String(row[columna] ?? '').trim().toLowerCase() === v) return row.id;
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
    { cliente_id: 'JUAN PEREZ', vehiculo_id: 'AB123CD', descripcion: 'CAMBIO CORREA', total_final: 135.22 },
    { cliente_id: 'JUAN PEREZ', vehiculo_id: 'AB123CD', descripcion: 'FRENOS', total_final: 88.5 },
    { cliente_id: 'MARIA LOPEZ', vehiculo_id: 'CD456EF', descripcion: 'SERVICIO', total_final: 250 },
  ]);

  assert.equal(res.insertados, 3);
  assert.equal(res.errores, 0);

  // Se crearon 2 clientes (JUAN y MARIA, JUAN reutilizado) y 2 vehículos
  assert.equal(adapter.conteo('clientes'), 2);
  assert.equal(adapter.conteo('vehiculos'), 2);
  assert.equal(adapter.conteo('ordenes_trabajo'), 3);

  // Los ids insertados en OT apuntan a los padres creados
  const clienteJuan = [...adapter.tablas.get('clientes').values()].find((c) => c.nombre === 'JUAN PEREZ');
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

  const res = await importarEnTabla(adapter, ot, [
    { cliente_id: 'NADIE EXISTE', vehiculo_id: 'XX999', descripcion: 'X' },
  ], { crearRelacionados: false });

  assert.equal(res.insertados, 0);
  assert.equal(adapter.conteo('clientes'), 0);
  // cliente_id no resuelto → no se inserta la OT (FK not null falla o se omite)
  assert.ok(res.errores > 0 || res.insertados === 0);
});

test('insertarConRelaciones: respeta transformaciones por columna', async () => {
  const adapter = new MockAdapter();
  const clientes = esquemaTaller.find((t) => t.nombre === 'clientes');

  const id = await insertarConRelaciones(adapter, clientes, { nombre: '  juan  ' }, {
    transform: { 'clientes.nombre': (v) => String(v).trim().toUpperCase() },
  });

  const fila = adapter.tablas.get('clientes').get(id);
  assert.equal(fila.nombre, 'JUAN');
});
