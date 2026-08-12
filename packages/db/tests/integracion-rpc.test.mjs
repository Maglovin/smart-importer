/**
 * Test de integración del adaptador Supabase con el JSON REAL del RPC
 * `schema_importable` (fixture capturado de la BD de producción).
 *
 * Garantiza que el pipeline parseSchemaRaw → schemaDesdeTabla funciona
 * con la forma exacta que devuelve PostgREST (no solo con el mock).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSchemaRaw, schemaDesdeTabla } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'schema-rpc.json'), 'utf8'),
);

test('integración: parseSchemaRaw parsea el fixture real del RPC', () => {
  const schema = parseSchemaRaw(fixture);

  // Tablas presentes en el fixture (primeras 3 del RPC real)
  const nombres = schema.map((t) => t.nombre);
  assert.ok(nombres.includes('clientes'));
  assert.ok(nombres.includes('ordenes_trabajo'));
  assert.ok(nombres.includes('perfiles'));

  // Columnas bien tipadas
  const clientes = schema.find((t) => t.nombre === 'clientes');
  assert.ok(clientes.columnas.some((c) => c.nombre === 'id' && c.pk && c.tipo === 'uuid'));
  assert.ok(clientes.columnas.some((c) => c.nombre === 'nombre' && c.not_null));
  // created_at (timestamp) existe como columna
  assert.ok(clientes.columnas.some((c) => c.nombre === 'created_at' && c.tipo.includes('timestamp')));
});

test('integración: FKs reales de ordenes_trabajo se resuelven con clave natural', () => {
  const schema = parseSchemaRaw(fixture);
  const ot = schema.find((t) => t.nombre === 'ordenes_trabajo');

  assert.ok(ot, 'ordenes_trabajo existe en el fixture');
  assert.ok(ot.fks.length >= 3, 'tiene FKs reales (clientes, vehiculos, perfiles…)');

  // Toda FK que apunte a una tabla conocida tiene columna_resolucion
  for (const fk of ot.fks) {
    const ref = schema.find((t) => t.nombre === fk.tabla_ref);
    if (ref) {
      assert.ok(
        fk.columna_resolucion && fk.columna_resolucion !== 'id',
        `FK ${fk.columna} → ${fk.tabla_ref} se resuelve por '${fk.columna_resolucion}' (no por id)`,
      );
    }
  }
});

test('integración: schemaDesdeTabla genera campos importables con la BD real', () => {
  const schema = parseSchemaRaw(fixture);
  const ot = schema.find((t) => t.nombre === 'ordenes_trabajo');

  const { schema: importSchema, relacionadas } = schemaDesdeTabla(ot);

  // No expone la PK ni columnas generadas
  assert.ok(!importSchema.campos.some((c) => c.id === 'id'));

  // Las FKs se marcan como relación con la clave natural
  const clienteField = importSchema.campos.find((c) => c.id === 'cliente_id');
  assert.ok(clienteField?.relacion, 'cliente_id tiene relacion');
  assert.equal(clienteField.relacion.tabla, 'clientes');
  assert.notEqual(clienteField.relacion.columna, 'id');

  // Las tablas relacionadas se listan
  assert.ok(relacionadas.includes('clientes'));
});
