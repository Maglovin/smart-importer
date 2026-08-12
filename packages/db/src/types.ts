/**
 * Tipos del adaptador de base de datos (@importador/db).
 *
 * El adaptador abstrae la lectura del esquema (tablas, columnas, FKs)
 * y las operaciones de búsqueda/inserción, de modo que el motor de
 * importación con resolución de relaciones funcione con cualquier
 * backend (Supabase, PostgREST directo, etc.).
 */

import type { ImportSchema, RawValue } from '@importador/core';

/** Columna de una tabla tal como la devuelve el esquema. */
export interface DbColumn {
  nombre: string;
  /** Tipo SQL (text, numeric(10,2), uuid…). */
  tipo: string;
  not_null: boolean;
  pk: boolean;
  /** true si es columna generada / identity (no se inserta). */
  generada: boolean;
}

/** Foreign key: columna local → tabla referenciada. */
export interface DbForeignKey {
  nombre: string;
  columna: string;
  tabla_ref: string;
  columna_ref: string;
  /** Columna de la tabla referenciada por la que se resuelve el enlace
   *  (la "clave natural": clientes.nombre, vehiculos.patente…). */
  columna_resolucion?: string;
}

export interface DbTable {
  nombre: string;
  columnas: DbColumn[];
  fks: DbForeignKey[];
}

/** Esquema completo de las tablas importables. */
export type DbSchema = DbTable[];

/** Operaciones mínimas que debe implementar un adaptador. */
export interface DbAdapter {
  /** Lee el esquema de tablas/columnas/FKs. */
  leerEsquema(): Promise<DbSchema>;
  /** Busca el id de una fila por columna de resolución (case-insensitive). */
  buscarId(tabla: string, columna: string, valor: RawValue): Promise<string | null>;
  /**
   * Busca una fila que coincida con TODAS las claves (AND, case-insensitive).
   * Opcional: solo necesario si se usa `dedupe`. Devuelve null si no existe.
   */
  buscarDuplicado?(tabla: string, claves: Record<string, unknown>): Promise<string | null>;
  /** Inserta una fila y devuelve su id. */
  insertar(tabla: string, fila: Record<string, unknown>): Promise<string>;
  /**
   * Actualiza una fila existente por id. Opcional: solo necesario si se usa
   * `dedupe` + `actualizarDuplicados`.
   */
  actualizar?(tabla: string, id: string, fila: Record<string, unknown>): Promise<void>;
}

/** Configuración del sink genérico. */
export interface DbImportOptions {
  /** Columnas de resolución por tabla (override de la detectada). */
  resolucion?: Record<string, string>;
  /** Crear el registro padre si no existe al resolver una FK (default true). */
  crearRelacionados?: boolean;
  /** Máximo de filas a procesar (default 10.000). */
  maxRows?: number;
  /** Mapa de transformaciones personalizadas por columna: tabla.columna → fn. */
  transform?: Record<string, (v: unknown) => unknown>;
  /**
   * Columnas que forman la clave natural para detectar duplicados
   * (p.ej. ['patente'] en vehículos, ['dni'] en clientes). Si la fila
   * entrante coincide con una existente en TODAS esas columnas, se omite
   * (o se actualiza si `actualizarDuplicados` es true).
   */
  dedupe?: string[];
  /**
   * Si hay duplicado y el adaptador soporta `actualizar()`, actualiza la
   * fila existente en vez de omitirla (upsert por clave natural).
   */
  actualizarDuplicados?: boolean;
}

/** Resultado de importar un lote en una tabla. */
export interface DbImportResult {
  insertados: number;
  omitidos: number;
  /** Filas saltadas porque ya existía un registro con la misma clave. */
  duplicados: number;
  /** Filas actualizadas en vez de insertadas (dedupe + actualizarDuplicados). */
  actualizados: number;
  errores: number;
  detalle: string[];
  /** ids de las filas insertadas (orden de entrada). */
  ids: string[];
}

/** Schema de importación generado desde una tabla + sus relaciones. */
export interface TablaImportable {
  tabla: DbTable;
  /** Schema listo para el ImportStepper. */
  schema: ImportSchema;
  /** Tablas relacionadas (para mostrar el grafo en la UI). */
  relacionadas: string[];
}
