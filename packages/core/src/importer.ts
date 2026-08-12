/**
 * Orquestador del importador: une parsing -> detección -> mapeo ->
 * transformación/validación -> dry-run/ejecución.
 *
 * Uso típico:
 *   const importer = new Importer(schema);
 *   const file = await importer.parse(buffer);          // detecta columnas
 *   const suggs = importer.suggest(file);               // auto-mapeo
 *   const dry = importer.dryRun(file, mapping);         // prueba en seco
 *   const ok = importer.execute(file, mapping, sink);   // importa
 */

import { detectColumns } from './detect.js';
import { suggestMappings } from './mapper.js';
import { TRANSFORMS } from './transform.js';
import type {
  ColumnMapping,
  DetectedColumn,
  DryRunResult,
  ImportOptions,
  ImportSchema,
  MappingSuggestion,
  ParsedFile,
  ProcessedRow,
  RawRow,
  RawValue,
} from './types.js';

/** Función que persiste una fila procesada (inserta en BD, API, etc.). */
export type ImportSink = (row: ProcessedRow) => Promise<void> | void;

export class Importer {
  constructor(
    readonly schema: ImportSchema,
    private readonly options: ImportOptions = {},
  ) {}

  /** 1. Parsear el archivo y detectar sus columnas. */
  async parse(parsed: ParsedFile): Promise<{ file: ParsedFile; columns: DetectedColumn[] }> {
    const file = this.capRows(parsed);
    const columns = detectColumns(file);
    return { file, columns };
  }

  /** 2. Sugerir mapeo automático columna -> campo. */
  suggest(file: ParsedFile): MappingSuggestion[] {
    const columns = detectColumns(file);
    return suggestMappings(columns, this.schema);
  }

  /**
   * 3. Dry-run: transforma y valida todas las filas con el mapeo dado,
   * sin tocar nada externo.
   */
  dryRun(file: ParsedFile, mapping: ColumnMapping[]): DryRunResult {
    const map = new Map(mapping.map((m) => [m.fieldId, m]));
    const rows = this.capRows(file).rows;

    const processed: ProcessedRow[] = rows.map(
      (row, i) => this.processRow(row, i + 2, map), // +2: cabecera es fila 1
    );

    const issues = processed.flatMap((r) => r.issues);
    const validRows = processed.filter((r) => !r.hasErrors);
    const errorRows = processed.filter((r) => r.hasErrors);
    const unmappedColumns = file.headers.filter((h) => !mapping.some((m) => m.columnName === h));

    return {
      totalRows: processed.length,
      validRows: validRows.length,
      errorRows: errorRows.length,
      issueCount: issues.length,
      issues,
      rows: processed,
      unmappedColumns,
    };
  }

  /**
   * 4. Ejecutar: dry-run + volcado a un sink (insertar en BD).
   * @param sink   función que persiste cada fila válida
   * @param opts   onRowStart/onRowEnd callbacks para progreso
   */
  async execute(
    file: ParsedFile,
    mapping: ColumnMapping[],
    sink: ImportSink,
    opts: { onRow?: (row: ProcessedRow, index: number) => void } = {},
  ): Promise<{ imported: number; skipped: number; result: DryRunResult }> {
    const result = this.dryRun(file, mapping);
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      if (row.hasErrors) {
        skipped++;
        continue;
      }
      await sink(row);
      imported++;
      opts.onRow?.(row, i);
    }
    return { imported, skipped, result };
  }

  // ── Internos ──────────────────────────────────────────────────

  private capRows(file: ParsedFile): ParsedFile {
    const max = this.options.maxRows ?? 10_000;
    if (file.rows.length <= max) return file;
    return { ...file, rows: file.rows.slice(0, max), rowCount: max };
  }

  private processRow(
    row: RawRow,
    rowNumber: number,
    map: Map<string, ColumnMapping>,
  ): ProcessedRow {
    const data: Record<string, RawValue> = {};
    const issues: ProcessedRow['issues'] = [];
    let hasErrors = false;

    for (const field of this.schema.campos) {
      const mapping = map.get(field.id);
      const raw = mapping ? (row[mapping.columnName] ?? null) : null;

      // Transformación estándar por tipo + custom
      let value: RawValue = raw;
      const stdTransform = TRANSFORMS[field.tipo];
      if (stdTransform && raw !== null && raw !== '') {
        value = stdTransform(raw);
      }
      if (field.transform && value !== null && value !== '') {
        value = field.transform(value, row);
      }

      // Validaciones
      if (field.requerido && (value === null || value === '' || value === undefined)) {
        issues.push({
          rowNumber,
          fieldId: field.id,
          severity: 'error',
          message: `Falta '${field.label}' (obligatorio)`,
        });
        hasErrors = true;
      } else if (value !== null && value !== '') {
        // Advertencia si el valor crudo no se pudo transformar (quedó igual)
        if (
          field.tipo !== 'texto' &&
          raw !== null &&
          typeof raw === 'string' &&
          raw.trim() !== '' &&
          value === raw
        ) {
          issues.push({
            rowNumber,
            fieldId: field.id,
            severity: 'warning',
            message: `'${field.label}' no se pudo interpretar como ${field.tipo}: "${String(raw).slice(0, 40)}"`,
          });
        }
        if (field.validar) {
          const err = field.validar(value, row);
          if (err) {
            issues.push({ rowNumber, fieldId: field.id, severity: 'error', message: err });
            hasErrors = true;
          }
        }
      }
      data[field.id] = value;
    }

    return { data, issues, hasErrors };
  }
}

/** Helper: construye un mapeo manual desde pares [columna, campoId]. */
export function buildMapping(
  pairs: Array<[columnName: string, fieldId: string]>,
  headers: string[],
): ColumnMapping[] {
  return pairs
    .filter(([col]) => headers.includes(col))
    .map(([col, fieldId]) => ({
      columnIndex: headers.indexOf(col),
      columnName: col,
      fieldId,
    }));
}

/** Helper: mapeo a partir de sugerencias (toma la mejor por campo). */
export function mappingFromSuggestions(suggestions: MappingSuggestion[]): ColumnMapping[] {
  const used = new Set<string>();
  const out: ColumnMapping[] = [];
  for (const s of suggestions.sort((a, b) => b.confidence - a.confidence)) {
    if (used.has(s.fieldId)) continue;
    used.add(s.fieldId);
    out.push({ columnIndex: s.columnIndex, columnName: s.columnName, fieldId: s.fieldId });
  }
  return out;
}
