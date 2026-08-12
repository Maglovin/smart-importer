/**
 * Parser XLSX: wrapper fino sobre SheetJS (xlsx).
 *
 * Elegimos la librería estándar para el parseo (edge cases de formatos,
 * fechas, fórmulas, hojas múltiples) y dedicamos el código propio al
 * valor diferencial: detección de columnas, mapeo y dry-run.
 */

import * as XLSX from 'xlsx';
import type { ParsedFile, RawRow, RawValue } from '../types.js';

export interface XlsxParseOptions {
  sheetIndex?: number;
}

/**
 * Lee un archivo XLSX (ArrayBuffer o Uint8Array) y devuelve el ParsedFile.
 * La primera fila no vacía se usa como cabecera; las celdas se convierten
 * a valores primitivos (fechas -> ISO string, números -> number).
 */
export async function parseXlsxFile(
  buffer: ArrayBuffer | Uint8Array,
  opts: XlsxParseOptions = {},
): Promise<ParsedFile> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });

  const sheetIndex = opts.sheetIndex ?? 0;
  const sheetName = wb.SheetNames[sheetIndex];
  if (!sheetName) throw new Error(`Hoja ${sheetIndex} no encontrada en el archivo`);

  const sheet = wb.Sheets[sheetName];
  // header: 1 -> primera fila como claves (A, B, C si está vacía)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const rows: RawRow[] = raw.map((r) => {
    const out: RawRow = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = normalizeCellValue(v);
    }
    return out;
  });

  const headers = Object.keys(raw[0] ?? {});
  // Filtrar filas completamente vacías
  const nonEmpty = rows.filter((r) => headers.some((h) => r[h] !== null && r[h] !== ''));

  return {
    rowCount: nonEmpty.length,
    headers,
    rows: nonEmpty,
    preview: nonEmpty.slice(0, 5),
  };
}

function normalizeCellValue(v: unknown): RawValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // Fecha -> ISO (pierde hora si es medianoche)
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return v;
  }
  if (typeof v === 'boolean') return v;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Nombres de hoja disponibles (útil para UI: "elegir hoja"). */
export function sheetNames(buffer: ArrayBuffer | Uint8Array): string[] {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(data, { type: 'array' });
  return wb.SheetNames;
}
