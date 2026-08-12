/**
 * Detección de columnas: infiere el tipo de cada columna muestreando
 * valores, calcula cobertura y extrae ejemplos para la UI.
 */

import type { DetectedColumn, FieldType, ParsedFile, RawValue } from './types.js';

const SAMPLE_SIZE = 50;

/** Clasifica un valor suelto en un tipo. */
export function inferValueType(v: RawValue): FieldType {
  if (v === null || v === undefined || v === '') return 'texto';
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'number') {
    // Serial Excel de fecha: 5 dígitos en rango plausible
    if (Number.isInteger(v) && v >= 20000 && v <= 60000) return 'fecha';
    return Number.isInteger(v) ? 'entero' : 'numero';
  }
  const s = String(v).trim();
  if (!s) return 'texto';

  // Patente Argentina/Chile: AB123CD / ABC123 / ABCD12
  if (
    /^[A-Z]{2,3}\d{2,3}[A-Z]{0,2}$/i.test(s) &&
    /[A-Za-z]/.test(s) &&
    /\d/.test(s) &&
    s.length >= 5
  ) {
    return 'patente';
  }
  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email';
  // Teléfono: dígitos con +, espacios, guiones (>= 6 dígitos)
  if (/^\+?[\d\s\-().]{6,20}$/.test(s) && /\d{6,}/.test(s)) return 'telefono';
  // Fecha ISO o DD/MM/YYYY o DD-MM-YYYY o serial Excel
  if (
    /^\d{4}-\d{2}-\d{2}/.test(s) ||
    /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s) ||
    /^\d{5}$/.test(s)
  ) {
    return 'fecha';
  }
  // Número con separadores de miles o decimales
  if (/^[+-]?[\d.,\s]+$/.test(s) && /\d/.test(s)) return 'numero';
  return 'texto';
}

/**
 * Infiere el tipo dominante de una columna muestreando valores.
 */
export function inferColumnType(values: RawValue[]): FieldType {
  if (!values.length) return 'texto';
  const counts = new Map<FieldType, number>();
  for (const v of values.slice(0, SAMPLE_SIZE)) {
    if (v === null || v === '' || v === undefined) continue;
    const t = inferValueType(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: FieldType = 'texto';
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Detecta las columnas de un archivo parseado.
 */
export function detectColumns(file: ParsedFile): DetectedColumn[] {
  return file.headers.map((header, idx) => {
    const values = file.rows.map((r) => r[header] ?? null);
    const nonEmpty = values.filter((v) => v !== null && v !== '' && v !== undefined);
    const examples = nonEmpty.slice(0, 3);
    return {
      nombre: header,
      tipoInferido: inferColumnType(values),
      cobertura: values.length ? nonEmpty.length / values.length : 0,
      ejemplos: examples,
      indice: idx,
    };
  });
}

/** Devuelve los nombres de columna con cobertura > umbral (importables). */
export function importableColumns(detected: DetectedColumn[], minCoverage = 0.3): DetectedColumn[] {
  return detected.filter((c) => c.cobertura >= minCoverage);
}
