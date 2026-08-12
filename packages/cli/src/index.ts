#!/usr/bin/env node
/**
 * CLI del importador.
 *
 * Uso:
 *   importador --file datos.xlsx --schema clientes --dry-run
 *   importador --file datos.csv  --schema ots --dry-run
 *   importador --demo             (genera un Excel de ejemplo y lo prueba)
 */

import { readFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import {
  Importer,
  parseXlsxFile,
  parseCsvFile,
  mappingFromSuggestions,
  schemaClientes,
  schemaVehiculos,
  schemaOTs,
  type ImportSchema,
} from '@importador/core';

const SCHEMAS: Record<string, ImportSchema> = {
  clientes: schemaClientes,
  vehiculos: schemaVehiculos,
  ots: schemaOTs,
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--demo')) {
    await runDemo();
    return;
  }

  const fileArg = argValue(args, '--file');
  const schemaArg = argValue(args, '--schema');
  const dryRun = args.includes('--dry-run');
  const maxRows = parseInt(argValue(args, '--max-rows') ?? '10000', 10);

  if (!fileArg || !schemaArg) {
    console.log(`
importador — Importación inteligente de Excel/CSV

Uso:
  importador --file <archivo> --schema <nombre> [--dry-run] [--max-rows N]

Schemas disponibles: ${Object.keys(SCHEMAS).join(', ')}
`);
    process.exit(1);
  }

  const schema = SCHEMAS[schemaArg];
  if (!schema) {
    console.error(`Schema '${schemaArg}' no existe. Disponibles: ${Object.keys(SCHEMAS).join(', ')}`);
    process.exit(1);
  }

  const buffer = await readFile(resolve(fileArg));
  const ext = extname(fileArg).toLowerCase();
  const parsed =
    ext === '.csv' ? await parseCsvFile(buffer) : await parseXlsxFile(buffer);

  const importer = new Importer(schema, { maxRows });
  const { file, columns } = await importer.parse(parsed);

  console.log(`\n📄 ${basename(fileArg)} — ${file.rowCount} filas, ${file.headers.length} columnas\n`);
  console.log('Columnas detectadas:');
  for (const c of columns) {
    console.log(`  • ${c.nombre}  (${c.tipoInferido}, ${Math.round(c.cobertura * 100)}% lleno)`);
  }

  const suggestions = importer.suggest(file);
  console.log('\nMapeo sugerido automáticamente:');
  for (const s of suggestions) {
    const mark = s.confidence >= 0.8 ? '✅' : s.confidence >= 0.5 ? '🟡' : '⚪';
    console.log(`  ${mark} ${s.columnName} → ${s.fieldId}  (${Math.round(s.confidence * 100)}%)`);
  }

  const mapping = mappingFromSuggestions(suggestions);
  const result = importer.dryRun(file, mapping);

  console.log(`\n${dryRun ? '🧪 DRY-RUN' : '📋 RESUMEN'}:`);
  console.log(`  Total:      ${result.totalRows}`);
  console.log(`  Válidas:    ${result.validRows}`);
  console.log(`  Con error:  ${result.errorRows}`);
  console.log(`  Problemas:  ${result.issueCount}`);
  if (result.unmappedColumns.length) {
    console.log(`  Sin mapear: ${result.unmappedColumns.join(', ')}`);
  }

  const errors = result.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    console.log('\nPrimeros errores:');
    for (const e of errors.slice(0, 5)) {
      console.log(`  ⛔ Fila ${e.rowNumber}: ${e.message}`);
    }
  }

  if (dryRun) {
    console.log('\n(no se importó nada — prueba en seco)');
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Genera un Excel de ejemplo en memoria y lo prueba. */
async function runDemo() {
  const { Importer, parseCsvFile } = await import('@importador/core');

  // CSV de ejemplo simulando FICHA CLIENTES.xlsx histórico
  const csv = `MATRICULA;KILOMETROS;BASTIDOR;MODELO;NOMBRE;APODO;TELEFONO;DNI;FECHA_ING;FECHA_PAGO;REPARACION;IMPORTE;MECANICO
AB123CD;181,854;VSSZZZ6RZCR012345;REN KANGOO;JAVIER PARDO;Javi;341-555-1234;28123456;45292;45310;CAMBIO DE CORREA;135+220;JUAN
CD456EF;95.000;WDB1234567890;FORD FIESTA;MARIA GOMEZ;Mary;3415559876;30123456;45305;;FRENOS DELANTEROS;438,02 II;PEDRO
EF789GH;;VF1XXXXXXX;TOYOTA COROLLA;CARLOS RUIZ;;(341) 555-1111;29111222;45310;;SERVICIO COMPLETO;1.234,56;JUAN
;120000;;;;;;;45320;45320;REVISION;;MARIA`;

  const parsed = await parseCsvFile(new TextEncoder().encode(csv), { separator: ';' });
  const importer = new Importer(schemaOTs, { maxRows: 100 });

  console.log('🧪 DEMO — Importador de órdenes de trabajo (schema: ots)\n');
  console.log(`CSV de ejemplo: ${parsed.rowCount} filas\n`);

  const { columns } = await importer.parse(parsed);
  console.log('Columnas detectadas:');
  for (const c of columns) {
    const ex = c.ejemplos.slice(0, 2).map((v) => `"${v}"`).join(', ');
    console.log(`  • ${c.nombre}  (${c.tipoInferido}, ${Math.round(c.cobertura * 100)}% lleno)  ej: ${ex}`);
  }

  const suggestions = importer.suggest(parsed);
  console.log('\nAuto-mapeo sugerido:');
  for (const s of suggestions) {
    const mark = s.confidence >= 0.8 ? '✅' : s.confidence >= 0.5 ? '🟡' : '⚪';
    console.log(`  ${mark} ${s.columnName} → ${s.fieldId}  (${Math.round(s.confidence * 100)}%)`);
  }

  const mapping = mappingFromSuggestions(suggestions);
  const result = importer.dryRun(parsed, mapping);

  console.log(`\nDRY-RUN: ${result.validRows}/${result.totalRows} filas válidas, ${result.issueCount} problemas`);
  if (result.unmappedColumns.length) {
    console.log(`Sin mapear: ${result.unmappedColumns.join(', ')}`);
  }

  console.log('\nPrimeras filas procesadas:');
  for (const row of result.rows.slice(0, 4)) {
    console.log('  ' + JSON.stringify(row.data));
  }

  const errors = result.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    console.log('\nErrores:');
    for (const e of errors.slice(0, 5)) console.log(`  ⛔ Fila ${e.rowNumber}: ${e.message}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
