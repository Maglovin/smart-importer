/**
 * Motor de mapeo: sugiere automáticamente qué columna de origen corresponde
 * a cada campo objetivo, usando:
 *   1. Normalización de nombres (minúsculas, sin acentos, sin símbolos)
 *   2. Diccionario de alias por campo
 *   3. Similitud de n-gramas (fuzzy) para variaciones
 *   4. Fallback por tipo inferido
 */

import type { DetectedColumn, ImportSchema, MappingSuggestion, TargetField } from './types.js';

// ── Normalización de nombres ─────────────────────────────────────

const MAP_ACCENTS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ü: 'u', Ñ: 'n',
};

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => MAP_ACCENTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Similitud de Jaccard entre conjuntos de bigramas (0-1). */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Contiene: 'numero documento' contiene 'documento'
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    if (s.length < 2) set.add(s);
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Palabras clave que ayudan al matching por tipo. */
const TYPE_HINTS: Record<string, string[]> = {
  fecha: ['fecha', 'dia', 'ingreso', 'pago', 'rep', 'reparacion'],
  telefono: ['telefono', 'tel', 'celular', 'movil', 'cel', 'whatsapp', 'contacto'],
  patente: ['patente', 'matricula', 'dominio', 'chapa'],
  email: ['email', 'correo', 'mail', 'e-mail'],
  numero: ['importe', 'total', 'monto', 'precio', 'costo', 'pesos', '$', 'valor'],
  entero: ['kilometros', 'km', 'año', 'anio', 'ano'],
};

/**
 * Sugiere el mapeo de todas las columnas detectadas contra el schema.
 * Devuelve una sugerencia por columna con la mejor confianza.
 */
export function suggestMappings(
  columns: DetectedColumn[],
  schema: ImportSchema,
  opts: { threshold?: number } = {},
): MappingSuggestion[] {
  const threshold = opts.threshold ?? 0.35;
  const suggestions: MappingSuggestion[] = [];

  for (const col of columns) {
    let best: MappingSuggestion | null = null;
    for (const field of schema.campos) {
      const score = scoreField(col, field);
      if (score.confidence > 0 && (!best || score.confidence > best.confidence)) {
        best = { ...score, columnIndex: col.indice, columnName: col.nombre };
      }
    }
    if (best && best.confidence >= threshold) suggestions.push(best);
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

function scoreField(col: DetectedColumn, field: TargetField): Omit<MappingSuggestion, 'columnIndex' | 'columnName'> {
  const colNorm = normalizeName(col.nombre);
  const fieldNorm = normalizeName(field.label);
  const aliases = (field.alias ?? []).map(normalizeName);

  // 1. Match exacto contra label o alias
  if (aliases.includes(colNorm) || fieldNorm === colNorm) {
    return { fieldId: field.id, confidence: 1, matchType: 'alias' };
  }
  // 2. Alias contenido (columna 'nombre y apellido' contra alias 'nombre')
  for (const a of aliases) {
    if (colNorm.includes(a) || a.includes(colNorm)) {
      return { fieldId: field.id, confidence: 0.85, matchType: 'alias' };
    }
  }
  // 3. Fuzzy contra label y alias
  let bestFuzzy = 0;
  for (const cand of [fieldNorm, ...aliases]) {
    const s = similarity(colNorm, cand);
    if (s > bestFuzzy) bestFuzzy = s;
  }
  if (bestFuzzy >= 0.6) {
    return { fieldId: field.id, confidence: bestFuzzy, matchType: 'fuzzy' };
  }
  // 4. Fallback por tipo inferido + pista de palabras
  const hints = TYPE_HINTS[field.tipo] ?? [];
  const colWords = colNorm.split(' ');
  const hit = hints.filter((h) => colWords.some((w) => w.includes(h) || h.includes(w)));
  if (hit.length) {
    return { fieldId: field.id, confidence: 0.5, matchType: 'tipo' };
  }
  // 5. Solo por tipo coincidente (baja confianza)
  if (col.tipoInferido === field.tipo) {
    return { fieldId: field.id, confidence: 0.4, matchType: 'tipo' };
  }
  return { fieldId: field.id, confidence: 0, matchType: 'tipo' };
}

/**
 * Encuentra la mejor columna para un campo dado (para UI "¿qué columna
 * va con este campo?"). Devuelve null si ninguna supera el umbral.
 */
export function suggestColumnForField(
  columns: DetectedColumn[],
  field: TargetField,
  threshold = 0.35,
): MappingSuggestion | null {
  let best: MappingSuggestion | null = null;
  for (const col of columns) {
    const score = scoreField(col, field);
    if (score.confidence > 0 && (!best || score.confidence > best.confidence)) {
      best = { ...score, columnIndex: col.indice, columnName: col.nombre };
    }
  }
  return best && best.confidence >= threshold ? best : null;
}

/** Detecta columnas duplicadas en cabecera (mismo nombre normalizado). */
export function duplicateColumns(headers: string[]): string[] {
  const seen = new Map<string, number>();
  const dupes: string[] = [];
  for (const h of headers) {
    const n = normalizeName(h);
    const c = seen.get(n) ?? 0;
    seen.set(n, c + 1);
    if (c >= 1) dupes.push(h);
  }
  return dupes;
}
