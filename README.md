# 🧮 Importador

Importación inteligente de Excel/CSV: **detecta columnas, sugiere el mapeo contra un schema declarativo y valida antes de importar**. Reutilizable en cualquier app.

Nació del importador hardcodeado del histórico de un taller (FICHA CLIENTES.xlsx → clientes/vehículos/OTs) y abstrae la parte reutilizable: el mapeo pasa de ser **código** a ser **datos/UI**.

## ✨ Qué hace

1. **Parse** `.xlsx` / `.xls` / `.csv` → filas normalizadas
2. **Detecta columnas** → tipo inferido (fecha, teléfono, patente, importe…), cobertura, ejemplos
3. **Auto-mapea** → cada columna contra los campos del schema (alias + fuzzy matching, con confianza 0-1)
4. **Transforma y valida** → seriales Excel a fecha, importes `'135+220'` → 135.22, km `'181,854'` → 181854, etc. Errores a nivel de fila
5. **Dry-run** → X válidas / Y errores / Z avisos + tabla de previsualización
6. **Importa** → solo filas válidas, con callback de persistencia

## 🏗 Arquitectura (monorepo)

```
packages/
  core/   → motor agnóstico de framework (Node + navegador)
  vue/    → componente <ImportStepper> (Vue 3)
  cli/    → importador desde terminal (--dry-run / importar)
examples/
  demo-vue/ → demo standalone desplegable (Vite)
  FICHA_CLIENTES.xlsx → archivo de ejemplo
```

## 🚀 Uso rápido

### CLI

```bash
npm run build
npm run demo                 # prueba con datos de ejemplo
npx importador --file datos.xlsx --schema ots --dry-run
```

### Como librería (core)

```ts
import { Importer, parseXlsxFile, mappingFromSuggestions, schemaOTs } from '@importador/core';

const parsed = await parseXlsxFile(buffer);
const importer = new Importer(schemaOTs);
const suggs = importer.suggest(parsed);               // auto-mapeo
const result = importer.dryRun(parsed, mappingFromSuggestions(suggs));
console.log(`${result.validRows}/${result.totalRows} válidas`);
```

### Componente Vue

```vue
<ImportStepper
  :schema="schemaOTs"
  titulo="Importar órdenes de trabajo"
  :on-import="(filas) => miAPI.insertar(filas)"
/>
```

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

Tipos soportados: `texto · numero · entero · fecha · telefono · patente · email · booleano`. Cada tipo trae su transformación (serial Excel → ISO, importe español, km con miles…) y validación. También admite `transform` y `validar` personalizados por campo.

## 🧪 Tests

```bash
npm test   # 9 tests: transformadores, detección, mapeo, dry-run
```

## 🛣 Roadmap

- [x] Core: parse, detect, map, transform, dry-run, execute
- [x] CLI con schemas de ejemplo (clientes / vehículos / ots)
- [x] Componente Vue (stepper 4 pasos)
- [x] Demo standalone + Excel de ejemplo
- [ ] Integración real en TallerApp (Supabase sink)
- [ ] Google Sheets como origen
- [ ] Dedupe/upsert por clave (evitar duplicados)
- [ ] Publicación npm (@importador/core, @importador/vue)
