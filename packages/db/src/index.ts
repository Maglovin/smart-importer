/**
 * @importador/db — Importación con conocimiento del esquema de la BD.
 *
 * Lee tablas/columnas/FKs (adaptador Supabase vía RPC `schema_importable`),
 * genera el ImportSchema de cualquier tabla y resuelve las relaciones
 * automáticamente al importar: busca el padre por su clave natural
 * (clientes.nombre, vehiculos.patente…) y lo crea si no existe.
 */

export * from './types.js';
export * from './importerDb.js';
export * from './adapters/supabase.js';
