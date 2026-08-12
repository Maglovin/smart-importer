#!/usr/bin/env node
/**
 * CLI del importador.
 *
 * Uso:
 *   importador --file datos.xlsx --schema clientes
 *   importador --file datos.csv  --schema ots --output resultado.json
 *   importador --demo             (genera un Excel de ejemplo y lo prueba)
 *
 * Sin --output: muestra el resumen sin escribir nada (dry-run, por defecto).
 * Con --output: además del resumen, escribe las filas válidas transformadas
 *               a un archivo JSON (la importación "real" a un destino).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import {
  Importer,
  parseXlsxFile,
  parseCsvFile,
  detectColumns,
  mappingFromSuggestions,
  schemaClientes,
  schemaVehiculos,
  schemaOTs,
  type ColumnMapping,
  type DetectedColumn,
  type DryRunResult,
  type ImportSchema,
  type MappingSuggestion,
  type ParsedFile,
} from '@importador/core';

const SCHEMAS: Record<string, ImportSchema> = {
  clientes: schemaClientes,
  vehiculos: schemaVehiculos,
  ots: schemaOTs,
};

const HELP = `
importador — Importación inteligente de Excel/CSV

Uso:
  importador --file <archivo> --schema <nombre> [--output <json>] [--max-rows N]

  --output    escribe las filas válidas transformadas a un JSON (importa "de verdad")
              (sin --output hace dry-run y no escribe nada)

Schemas disponibles: ${Object.keys(SCHEMAS).join(', ')}
`;

/** Resultado intermedio del pipeline parse → detect → map → dry-run. */
interface Procesado {
  file: ParsedFile;
  columns: DetectedColumn[];
  suggestions: MappingSuggestion[];
  mapping: ColumnMapping[];
  result: DryRunResult;
}

/** Ejecuta el pipeline completo sobre un archivo parseado. */
function procesar(parsed: ParsedFile, schema: ImportSchema, maxRows: number): Procesado {
  const importer = new Importer(schema, { maxRows });
  const file = parsed;
  const columns = detectColumns(parsed);
  const suggestions = importer.suggest(parsed);
  const mapping = mappingFromSuggestions(suggestions);
  const result = importer.dryRun(parsed, mapping);
  return { file, columns, suggestions, mapping, result };
}

/** Imprime las columnas detectadas y el mapeo sugerido. */
function mostrarDetalle(p: Procesado, nombreArchivo: string) {
  const { file, columns, suggestions } = p;
  console.log(`\n📄 ${nombreArchivo} — ${file.rowCount} filas, ${file.headers.length} columnas\n`);
  console.log('Columnas detectadas:');
  for (const c of columns) {
    console.log(`  • ${c.nombre}  (${c.tipoInferido}, ${Math.round(c.cobertura * 100)}% lleno)`);
  }
  console.log('\nMapeo sugerido automáticamente:');
  for (const s of suggestions) {
    const mark = s.confidence >= 0.8 ? '✅' : s.confidence >= 0.5 ? '🟡' : '⚪';
    console.log(`  ${mark} ${s.columnName} → ${s.fieldId}  (${Math.round(s.confidence * 100)}%)`);
  }
}

/** Imprime el resumen del dry-run. */
function mostrarResumen(p: Procesado, dryRun: boolean) {
  const { result } = p;
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
}

/** Filas válidas transformadas, listas para persistir. */
function filasValidas(p: Procesado): Array<Record<string, unknown>> {
  return p.result.rows.filter((r) => !r.hasErrors).map((r) => r.data);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--demo')) {
    await runDemo();
    return;
  }

  const fileArg = argValue(args, '--file');
  const schemaArg = argValue(args, '--schema');
  const outputArg = argValue(args, '--output');
  const maxRows = parseInt(argValue(args, '--max-rows') ?? '10000', 10);

  if (!fileArg || !schemaArg) {
    console.log(HELP);
    process.exit(1);
  }

  const schema = SCHEMAS[schemaArg];
  if (!schema) {
    console.error(
      `Schema '${schemaArg}' no existe. Disponibles: ${Object.keys(SCHEMAS).join(', ')}`,
    );
    process.exit(1);
  }

  const buffer = await readFile(resolve(fileArg));
  const ext = extname(fileArg).toLowerCase();
  const parsed = ext === '.csv' ? await parseCsvFile(buffer) : await parseXlsxFile(buffer);

  const p = procesar(parsed, schema, maxRows);
  mostrarDetalle(p, basename(fileArg));

  if (outputArg) {
    mostrarResumen(p, false);
    const filas = filasValidas(p);
    await writeFile(resolve(outputArg), JSON.stringify(filas, null, 2), 'utf8');
    console.log(`\n✅ ${filas.length} filas válidas escritas en ${outputArg}`);
  } else {
    mostrarResumen(p, true);
    console.log('\n(no se importó nada — usa --output <archivo.json> para exportar)');
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Genera un CSV de ejemplo en memoria y lo prueba. */
async function runDemo() {
  // CSV de ejemplo simulando FICHA CLIENTES.xlsx histórico
  const csv = `MATRICULA;KILOMETROS;BASTIDOR;MODELO;NOMBRE;APODO;TELEFONO;DNI;FECHA_ING;FECHA_PAGO;REPARACION;IMPORTE;MECANICO
AB123CD;181,854;VSSZZZ6RZCR012345;REN KANGOO;JAVIER PARDO;Javi;341-555-1234;28123456;45292;45310;CAMBIO DE CORREA;135+220;JUAN
CD456EF;95.000;WDB1234567890;FORD FIESTA;MARIA GOMEZ;Mary;3415559876;30123456;45305;;FRENOS DELANTEROS;438,02 II;PEDRO
EF789GH;;VF1XXXXXXX;TOYOTA COROLLA;CARLOS RUIZ;;(341) 555-1111;29111222;45310;;SERVICIO COMPLETO;1.234,56;JUAN
;120000;;;;;;;45320;45320;REVISION;;MARIA`;

  const parsed = await parseCsvFile(new TextEncoder().encode(csv), { separator: ';' });
  console.log('🧪 DEMO — Importador de órdenes de trabajo (schema: ots)\n');
  console.log(`CSV de ejemplo: ${parsed.rowCount} filas\n`);

  const p = procesar(parsed, schemaOTs, 100);
  for (const c of p.columns) {
    const ex = c.ejemplos
      .slice(0, 2)
      .map((v) => `"${v}"`)
      .join(', ');
    console.log(
      `  • ${c.nombre}  (${c.tipoInferido}, ${Math.round(c.cobertura * 100)}% lleno)  ej: ${ex}`,
    );
  }

  console.log('\nAuto-mapeo sugerido:');
  for (const s of p.suggestions) {
    const mark = s.confidence >= 0.8 ? '✅' : s.confidence >= 0.5 ? '🟡' : '⚪';
    console.log(`  ${mark} ${s.columnName} → ${s.fieldId}  (${Math.round(s.confidence * 100)}%)`);
  }

  console.log(
    `\nDRY-RUN: ${p.result.validRows}/${p.result.totalRows} filas válidas, ${p.result.issueCount} problemas`,
  );
  if (p.result.unmappedColumns.length) {
    console.log(`Sin mapear: ${p.result.unmappedColumns.join(', ')}`);
  }

  console.log('\nPrimeras filas procesadas:');
  for (const row of p.result.rows.slice(0, 4)) {
    console.log('  ' + JSON.stringify(row.data));
  }
  mostrarResumen(p, true);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
