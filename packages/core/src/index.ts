/**
 * @importador/core — Motor de importación inteligente de Excel/CSV.
 *
 * Detecta columnas, sugiere mapeos contra un schema declarativo,
 * transforma/valida filas y ejecuta dry-run o importación real.
 * Agnóstico de framework: usable desde Node, navegador, Vue, React...
 */

export * from './types.js';
export * from './detect.js';
export * from './mapper.js';
export * from './transform.js';
export * from './importer.js';
export * from './schemas.js';
export { parseXlsxFile, sheetNames } from './parsers/xlsx.js';
export { parseCsvFile } from './parsers/csv.js';
