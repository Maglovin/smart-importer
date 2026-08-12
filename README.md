# 🧮 Importador — importación inteligente de Excel/CSV

[![CI](https://github.com/Maglovin/smart-importer/actions/workflows/ci.yml/badge.svg)](https://github.com/Maglovin/smart-importer/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vue](https://img.shields.io/badge/Vue-3.x-42b883?logo=vue.js&logoColor=white)](https://vuejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Motor de importación de datos **reutilizable en cualquier app**: detecta columnas del archivo, sugiere el mapeo contra un schema declarativo, transforma/valida con prueba en seco y — con `@importador/db` — **lee el esquema de tu base de datos, resuelve las relaciones (FKs) y evita duplicados automáticamente**.

> Nació del importador hardcodeado del histórico de un taller mecánico (FICHA CLIENTES.xlsx → clientes/vehículos/OTs) y abstrae la parte reutilizable: el mapeo pasa de ser **código** a ser **datos + UI**.

```
npm test   # 19 tests (core + db)
```

## ✨ Qué hace

| Paso | Qué ocurre |
|---|---|
| **1. Parse** | Lee `.xlsx` / `.xls` / `.csv` → filas normalizadas |
| **2. Detecta** | Infiere tipo de cada columna (fecha, teléfono, patente, importe…), cobertura y ejemplos |
| **3. Auto-mapea** | Sugiere columna → campo del schema (alias + fuzzy matching con confianza 0–1) |
| **4. Transforma y valida** | Seriales Excel → fecha ISO, importes `'135+220'` → 135.22, km `'181,854'` → 181854… Errores a nivel de fila |
| **5. Dry-run** | X válidas / Y errores / Z avisos + tabla de previsualización |
| **6. Importa** | Solo filas válidas, con callback de persistencia (BD, API, lo que sea) |

**Bonus (`@importador/db`)**: importar en cualquier tabla de la BD sin escribir un schema a mano — las columnas y las FKs se detectan solas.

## 🏗 Arquitectura (monorepo npm)

```
packages/
  core/   → motor agnóstico de framework (Node + navegador)
            parse · detect · map · transform · dry-run · execute
  db/     → integración con BD: lee tablas/columnas/FKs (adaptador Supabase),
            genera el schema de cualquier tabla y resuelve relaciones al importar
  vue/    → componente <ImportStepper> (Vue 3): subir → mapear → validar → listo
  cli/    → importador desde terminal (--dry-run / importar)
examples/
  demo-vue/          → demo standalone (Vite)
  FICHA_CLIENTES.xlsx → archivo de ejemplo real
```

## 🚀 Uso rápido

### CLI

```bash
npm run build
npm run demo                    # prueba con datos de ejemplo

npx importador --file datos.xlsx --schema ots --dry-run
npx importador --file datos.csv --schema clientes
```

### Como librería (`@importador/core`)

```ts
import { Importer, parseXlsxFile, mappingFromSuggestions, schemaOTs } from '@importador/core';

const parsed = await parseXlsxFile(buffer);
const importer = new Importer(schemaOTs);
const suggs = importer.suggest(parsed);                          // auto-mapeo
const result = importer.dryRun(parsed, mappingFromSuggestions(suggs));

console.log(`${result.validRows}/${result.totalRows} válidas`);
```

### Componente Vue (`@importador/vue`)

```vue
<ImportStepper
  :schema="schemaOTs"
  titulo="Importar órdenes de trabajo"
  :on-import="(filas) => miAPI.insertar(filas)"
/>
```

## 🗄 Importación "por tabla" (`@importador/db`)

El modo estrella: **conéctalo a tu base de datos y deja que descubra el esquema solo**.

```ts
import { supabaseAdapter, schemaDesdeTabla, importarEnTabla } from '@importador/db';

const adapter = supabaseAdapter(supabase);      // RPC schema_importable + REST

// 1. Lee el esquema: tablas, columnas, tipos y FKs
const esquema = await adapter.leerEsquema();

// 2. Elige una tabla → el schema de importación se genera solo
const tabla = esquema.find((t) => t.nombre === 'ordenes_trabajo');
const importable = schemaDesdeTabla(tabla);
//    → cliente_id, vehiculo_id… se marcan como relación
//      (clientes.nombre, vehiculos.patente…)

// 3. Importa: cada FK se resuelve por su clave natural
//    y se CREA el registro padre si no existe (recursivamente)
const res = await importarEnTabla(adapter, tabla, filas);
// { insertados: 3, omitidos: 0, errores: 0, detalle: [], ids: [...] }
```

Qué resuelve por ti:

- **FKs automáticas** — `cliente_id` se enlaza buscando `clientes.nombre` (o la primera columna de texto de la tabla referenciada); se puede sobreescribir con `opts.resolucion`.
- **Creación de padres** — si el cliente/vehículo no existe, se crea (resolviendo a su vez SUS FKs, con detección de ciclos).
- **Propagación de relaciones** — un vehículo creado desde una OT hereda el `cliente_id` ya resuelto de la OT.
- **Cache entre filas** — una misma persona/patente repetida se resuelve una sola vez.
- **`crearRelacionados: false`** — falla la fila en vez de crear padres (modo estricto).

### 🚫 Dedupe: no llenar la BD de duplicados

Pasa las columnas que forman la clave natural de la tabla y el importador **omite (o actualiza) las filas que ya existen**:

```ts
// Clientes: no crear dos veces al mismo DNI
await importarEnTabla(adapter, tablaClientes, filas, {
  dedupe: ['dni'],
});

// Vehículos: una sola vez por patente, y si ya existe se actualiza (upsert)
await importarEnTabla(adapter, tablaVehiculos, filas, {
  dedupe: ['patente'],
  actualizarDuplicados: true,   // en vez de omitir, actualiza la fila existente
});

// Clave compuesta: coincidencia AND en todas las columnas
await importarEnTabla(adapter, tablaClientes, filas, {
  dedupe: ['nombre', 'telefono'],
});
```

Comportamiento:

- **`dedupe: ['columna']`** — compara contra lo existente (case-insensitive); si coincide, la fila se **omite** y cuenta en `resultado.duplicados`.
- **`actualizarDuplicados: true`** — en vez de omitir, hace **upsert**: actualiza la fila existente con los datos nuevos (requiere que el adaptador implemente `actualizar()`).
- **Clave incompleta** (valor vacío en alguna columna clave) → no se puede comparar, la fila se inserta igual.
- Las **FKs no se tocan** en la actualización: el update por clave natural solo toca columnas normales.

El RPC `schema_importable` lo provee cada app con una migración SQL (ejemplo en la sección de adapters).

## 📐 El contrato: schema declarativo

Cada app define qué campos quiere importar — el motor hace el resto:

```ts
const schemaClientes: ImportSchema = {
  nombre: 'clientes',
  campos: [
    { id: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true,
      alias: ['nombre', 'name', 'cliente', 'titular'] },
    { id: 'telefono', label: 'Teléfono', tipo: 'telefono',
      alias: ['telefono', 'tel', 'celular', 'whatsapp'] },
    { id: 'fecha_ingreso', label: 'Fecha ingreso', tipo: 'fecha',
      alias: ['fecha', 'ingreso', 'fecha rep'] },
  ],
};
```

Tipos soportados: `texto · numero · entero · fecha · telefono · patente · email · booleano`.
Cada tipo trae su transformación (serial Excel → ISO, importe español, km con miles…) y validación. También admite `transform` y `validar` personalizados por campo, y `relacion` para resolver FKs.

## 🧪 Tests

```bash
npm test                 # 9 tests core: transformadores, detección, mapeo, dry-run
npm run test -w @importador/db   # 10 tests db: schema desde tabla, FKs, padres, dedupe, regresión TDZ
```

CI (GitHub Actions) ejecuta build + tests en Node 20 y 22 en cada push/PR.

## 🛣 Roadmap

- [x] Core: parse, detect, map, transform, dry-run, execute
- [x] CLI con schemas de ejemplo (clientes / vehículos / ots)
- [x] Componente Vue (stepper 4 pasos)
- [x] `@importador/db`: esquema desde BD, FKs automáticas, creación de padres
- [x] **Dedupe/upsert por clave natural** (evitar duplicados en la BD)
- [x] CI (GitHub Actions, Node 20/22) + badges
- [x] Demo standalone + Excel de ejemplo
- [ ] Integración en producción (TallerApp: importador de histórico completo)
- [ ] Google Sheets como origen
- [ ] Publicación npm (`@importador/core`, `@importador/db`, `@importador/vue`)

## 📄 Licencia

MIT
