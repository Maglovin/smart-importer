/**
 * Tests del core: transformadores, detección, mapeo y dry-run.
 * Se ejecutan con: npm run test -w @importador/core
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ejecutar contra el código fuente con strip-types (Node 22+) o el build.
import {
  extraeImporte,
  serialAFecha,
  normalizaNombre,
  separaMarcaModelo,
  limpiaTelefono,
  limpiaPatente,
  parseaKilometros,
  normalizaFecha,
} from '../dist/index.js';

// ── Transformadores ──────────────────────────────────────────────

test('extraeImporte: formatos del histórico', () => {
  assert.equal(extraeImporte('438,02 II'), 438.02);
  assert.equal(extraeImporte('135+220'), 135.22);
  assert.equal(extraeImporte('1.234,56'), 1234.56);
  assert.equal(extraeImporte('218'), 218);
  assert.equal(extraeImporte('235+IVA'), 235);
  assert.equal(extraeImporte(null), null);
  assert.equal(extraeImporte(''), null);
});

test('serialAFecha: serial Excel -> ISO', () => {
  assert.equal(serialAFecha('45292'), '2024-01-01');
  assert.equal(serialAFecha(45305), '2024-01-14');
  assert.equal(serialAFecha('abc'), null);
  assert.equal(serialAFecha('123'), null); // fuera de rango
});

test('normalizaNombre: espacios y mayúsculas', () => {
  assert.equal(normalizaNombre('  JAVIER  PARDO  '), 'JAVIER PARDO');
  assert.equal(normalizaNombre('  '), null);
});

test('separaMarcaModelo: marca + modelo', () => {
  assert.deepEqual(separaMarcaModelo('REN KANGOO'), ['RENAULT', 'KANGOO']);
  assert.deepEqual(separaMarcaModelo('FORD FIESTA'), ['FORD', 'FIESTA']);
  assert.deepEqual(separaMarcaModelo('LAND ROVER EVOQUE'), ['LAND ROVER', 'EVOQUE']);
  assert.deepEqual(separaMarcaModelo(null), ['SIN MARCA', 'SIN MODELO']);
});

test('limpiaTelefono / limpiaPatente', () => {
  assert.equal(limpiaTelefono('341-555-1234'), '3415551234');
  assert.equal(limpiaPatente('  ab 123 cd '), 'AB 123 CD');
});

test('parseaKilometros: miles con coma', () => {
  assert.equal(parseaKilometros('181,854 KM'), 181854);
  assert.equal(parseaKilometros('157.578'), 157578);
  assert.equal(parseaKilometros('12345'), 12345);
  assert.equal(parseaKilometros('abc'), null);
});

test('normalizaFecha: formatos variados', () => {
  assert.equal(normalizaFecha('01/02/2024'), '2024-02-01');
  assert.equal(normalizaFecha('01-02-24'), '2024-02-01');
  assert.equal(normalizaFecha('2024-02-01'), '2024-02-01');
  assert.equal(normalizaFecha('45292'), '2024-01-01');
  assert.equal(normalizaFecha('no es fecha'), null);
});

// ── Mapeo ───────────────────────────────────────────────────────

test('similarity: normaliza acentos y detecta variantes', async () => {
  const { similarity, normalizeName } = await import('../dist/index.js');
  assert.equal(normalizeName('Teléfono'), 'telefono');
  assert.equal(normalizeName('NOMBRE CLIENTE'), 'nombre cliente');
  assert.ok(similarity('telefono', 'Teléfono') > 0.9);
  assert.ok(similarity('fecha ingreso', 'fecha_ing') > 0.5);
  assert.equal(similarity('abc', 'xyz'), 0);
});

test('suggestMappings: alias exactos y fuzzy', async () => {
  const { suggestMappings } = await import('../dist/index.js');
  const schema = {
    nombre: 'clientes-test',
    campos: [
      {
        id: 'nombre',
        label: 'Nombre',
        tipo: 'texto',
        requerido: true,
        alias: ['nombre', 'name', 'cliente'],
      },
      {
        id: 'telefono',
        label: 'Teléfono',
        tipo: 'telefono',
        alias: ['telefono', 'tel', 'celular'],
      },
      { id: 'dni', label: 'DNI', tipo: 'texto', alias: ['dni', 'documento'] },
    ],
  };
  const columns = [
    { nombre: 'NOMBRE', tipoInferido: 'texto', cobertura: 1, ejemplos: ['JUAN'], indice: 0 },
    { nombre: 'TEL', tipoInferido: 'telefono', cobertura: 1, ejemplos: ['341'], indice: 1 },
    { nombre: 'DOCUMENTO', tipoInferido: 'texto', cobertura: 1, ejemplos: ['28'], indice: 2 },
  ];
  const suggs = suggestMappings(columns, schema);
  assert.ok(
    suggs.some((s) => s.columnName === 'NOMBRE' && s.fieldId === 'nombre' && s.confidence === 1),
  );
  assert.ok(suggs.some((s) => s.columnName === 'TEL' && s.fieldId === 'telefono'));
  assert.ok(suggs.some((s) => s.columnName === 'DOCUMENTO' && s.fieldId === 'dni'));
});
