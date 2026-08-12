/**
 * Tipos del dominio del importador.
 * El diseño es agnóstico de framework: cualquier app declara un "schema"
 * con los campos que quiere importar y el motor hace el resto.
 */

/** Valor crudo de una celda tal y como sale del parser. */
export type RawValue = string | number | boolean | null;

/** Fila cruda: nombre de columna -> valor. */
export type RawRow = Record<string, RawValue>;

/** Resultado de parsear un archivo. */
export interface ParsedFile {
  /** Número de filas de datos (excluyendo cabecera). */
  rowCount: number;
  /** Cabeceras detectadas (nombres de columna). */
  headers: string[];
  /** Filas crudas, indexadas por nombre de columna. */
  rows: RawRow[];
  /** Primeras filas para previsualización. */
  preview: RawRow[];
}

/** Tipos de campo soportados por el motor. */
export type FieldType =
  | 'texto'
  | 'numero'
  | 'entero'
  | 'fecha'
  | 'telefono'
  | 'patente'
  | 'email'
  | 'booleano';

/** Declaración de un campo objetivo que queremos importar. */
export interface TargetField {
  /** Identificador estable del campo (p.ej. 'cliente.nombre'). */
  id: string;
  /** Etiqueta legible para la UI. */
  label: string;
  /** Tipo de dato: dispara transformación + validación automáticas. */
  tipo: FieldType;
  /** El campo es obligatorio en el destino. */
  requerido?: boolean;
  /** Nombres alternativos de columna que el auto-suggest debe reconocer. */
  alias?: string[];
  /** Descripción corta para la UI. */
  descripcion?: string;
  /** Transformación personalizada (se ejecuta después de la estándar). */
  transform?: (valor: RawValue, fila: RawRow) => RawValue;
  /** Validación personalizada: devuelve mensaje de error o null si OK. */
  validar?: (valor: RawValue, fila: RawRow) => string | null;
}

/** Schema objetivo: la declaración de qué queremos importar. */
export interface ImportSchema {
  /** Nombre del import (p.ej. 'clientes'). */
  nombre: string;
  /** Campos que se pueden mapear. */
  campos: TargetField[];
}

/** Estado de una columna detectada en el archivo de origen. */
export interface DetectedColumn {
  /** Nombre de la columna tal cual viene en la cabecera. */
  nombre: string;
  /** Tipo inferido por muestreo de valores. */
  tipoInferido: FieldType;
  /** % de celdas no vacías (0-1). */
  cobertura: number;
  /** Ejemplos de valores (para mostrar en UI). */
  ejemplos: RawValue[];
  /** Posición 0-based en la cabecera. */
  indice: number;
}

/** Sugerencia de mapeo: columna de origen -> campo objetivo. */
export interface MappingSuggestion {
  /** Índice de la columna de origen. */
  columnIndex: number;
  /** Nombre de la columna de origen. */
  columnName: string;
  /** id del campo objetivo sugerido. */
  fieldId: string;
  /** Confianza 0-1. 1 = match exacto/alias, <1 = fuzzy. */
  confidence: number;
  /** Cómo se encontró el match. */
  matchType: 'exact' | 'alias' | 'fuzzy' | 'tipo';
}

/** Mapeo final decidido por el usuario. */
export interface ColumnMapping {
  /** Índice de la columna de origen (o -1 para "no mapear"). */
  columnIndex: number;
  /** Nombre de la columna de origen. */
  columnName: string;
  /** id del campo objetivo. */
  fieldId: string;
}

/** Severidad de un problema en una fila. */
export type IssueSeverity = 'error' | 'warning';

/** Problema detectado en una fila durante validación/transformación. */
export interface RowIssue {
  /** Número de fila (1-based, incluyendo cabecera). */
  rowNumber: number;
  fieldId: string;
  severity: IssueSeverity;
  message: string;
}

/** Fila ya transformada y validada, lista para consumir. */
export interface ProcessedRow {
  /** Datos transformados: fieldId -> valor. */
  data: Record<string, RawValue>;
  /** Problemas encontrados en esta fila. */
  issues: RowIssue[];
  /** true si tiene algún error (no importable sin corregir). */
  hasErrors: boolean;
}

/** Resultado del dry-run: qué pasaría si se importa. */
export interface DryRunResult {
  /** Total de filas procesadas. */
  totalRows: number;
  /** Filas sin errores. */
  validRows: number;
  /** Filas con al menos un error. */
  errorRows: number;
  /** Número total de problemas (errores + warnings). */
  issueCount: number;
  /** Problemas agrupados para mostrar en UI. */
  issues: RowIssue[];
  /** Filas procesadas completas. */
  rows: ProcessedRow[];
  /** Columnas no mapeadas (ignoradas). */
  unmappedColumns: string[];
}

/** Configuración del importador. */
export interface ImportOptions {
  /** Filas máximas a procesar (defensa contra archivos gigantes). */
  maxRows?: number;
  /** Índice (0-based) de la fila que es cabecera; null = autodetect. */
  headerRow?: number | null;
  /** Hoja a leer en XLSX (0-based). */
  sheetIndex?: number;
}
