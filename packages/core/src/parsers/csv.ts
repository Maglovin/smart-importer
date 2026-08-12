/**
 * Parser CSV: maneja separadores comunes (coma, punto y coma, tab),
 * comillas, CRLF y BOM. Sin dependencias.
 */

import type { ParsedFile, RawRow, RawValue } from '../types.js';

export interface CsvParseOptions {
  /** Separador; si no se indica, se autodetecta. */
  separator?: string;
}

const SEPARATORS = [',', ';', '\t', '|'];

export async function parseCsvFile(
  buffer: ArrayBuffer | Uint8Array,
  opts: CsvParseOptions = {},
): Promise<ParsedFile> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text = new TextDecoder('utf-8').decode(data);

  // Quitar BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Normalizar CRLF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const separator = opts.separator ?? detectSeparator(text);
  const rows = parseCsvRows(text, separator);
  if (!rows.length) return { rowCount: 0, headers: [], rows: [], preview: [] };

  const headers = rows[0].map((h) => (h ?? '').trim() || '');
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v !== null && v !== ''));

  const out: RawRow[] = dataRows.map((r) => {
    const obj: RawRow = {};
    headers.forEach((h, i) => {
      obj[h || `col_${i + 1}`] = coerce(r[i] ?? null);
    });
    return obj;
  });

  return {
    rowCount: out.length,
    headers,
    rows: out,
    preview: out.slice(0, 5),
  };
}

function detectSeparator(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const sep of SEPARATORS) {
    const count = firstLine.split(sep).length;
    if (count > bestCount) {
      bestCount = count;
      best = sep;
    }
  }
  return best;
}

function parseCsvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Último campo/fila sin salto de línea final
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function coerce(v: string): RawValue {
  const t = v.trim();
  if (t === '') return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  // Solo números con punto decimal o enteros: la coma se DEJA como texto
  // porque en formato europeo '181,854' son miles (181854 km), no decimales.
  // Los transformadores del motor (importe, kilometros, fecha) interpretan
  // las cadenas con coma correctamente.
  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  if (/^[+-]?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}
