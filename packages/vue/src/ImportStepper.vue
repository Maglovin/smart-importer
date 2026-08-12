<script setup lang="ts">
/**
 * ImportStepper — componente Vue 3 del importador inteligente.
 *
 * Flujo: 1. Subir archivo → 2. Mapear columnas → 3. Validar (dry-run) → 4. Importar.
 *
 * Props:
 *   schema    — ImportSchema declarativo (qué campos queremos importar)
 *   onImport  — callback que recibe las filas válidas para persistirlas
 *
 * Emite:
 *   imported  — { filas, result } tras confirmar la importación
 */

import { computed, ref, watch } from 'vue';
import {
  Importer,
  parseCsvFile,
  parseXlsxFile,
  sheetNames,
  detectColumns,
  suggestMappings,
  mappingFromSuggestions,
  suggestColumnForField,
  type ColumnMapping,
  type DetectedColumn,
  type DryRunResult,
  type ImportSchema,
  type MappingSuggestion,
  type ParsedFile,
} from '@importador/core';

const props = defineProps<{
  schema: ImportSchema;
  titulo?: string;
  descripcion?: string;
  onImport?: (filas: Array<Record<string, unknown>>, result: DryRunResult) => Promise<void> | void;
}>();

const emit = defineEmits<{
  (e: 'imported', payload: { filas: Array<Record<string, unknown>>; result: DryRunResult }): void;
}>();

// ── Estado del flujo ────────────────────────────────────────────
type Paso = 1 | 2 | 3 | 4;
const paso = ref<Paso>(1);
const pasos = [
  { n: 1, label: 'Archivo' },
  { n: 2, label: 'Mapear' },
  { n: 3, label: 'Validar' },
  { n: 4, label: 'Listo' },
];

const error = ref<string | null>(null);
const cargando = ref(false);

// ── Paso 1: archivo ─────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref<string>('');
const sheetNamesList = ref<string[]>([]);
const sheetIndex = ref(0);
const parsed = ref<ParsedFile | null>(null);
const columns = ref<DetectedColumn[]>([]);
const dragOver = ref(false);

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await loadFile(file);
}

async function onDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) await loadFile(file);
}

async function loadFile(file: File) {
  error.value = null;
  cargando.value = true;
  try {
    const buffer = await file.arrayBuffer();
    const ext = file.name.toLowerCase().split('.').pop();

    if (ext === 'xlsx' || ext === 'xls') {
      sheetNamesList.value = sheetNames(buffer);
      fileName.value = file.name;
      sheetIndex.value = 0;
      await parseSheet(buffer, 0);
    } else if (ext === 'csv') {
      parsed.value = await parseCsvFile(buffer);
      fileName.value = file.name;
      sheetNamesList.value = [];
      sheetIndex.value = 0;
    } else {
      error.value = 'Formato no soportado: usa .xlsx o .csv';
      return;
    }
    goToPaso2();
  } catch (err) {
    error.value = `No se pudo leer el archivo: ${(err as Error).message}`;
  } finally {
    cargando.value = false;
  }
}

async function parseSheet(buffer: ArrayBuffer, idx: number) {
  parsed.value = await parseXlsxFile(buffer, { sheetIndex: idx });
}

async function onSheetChange(idx: number) {
  if (!fileName.value) return;
  const file = fileInput.value?.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await parseSheet(buffer, idx);
  goToPaso2();
}

// ── Paso 2: mapeo ───────────────────────────────────────────────
const mapping = ref<ColumnMapping[]>([]);
const suggs = ref<MappingSuggestion[]>([]);

function goToPaso2() {
  if (!parsed.value) return;
  columns.value = detectColumns(parsed.value);
  suggs.value = suggestMappings(columns.value, props.schema);
  mapping.value = mappingFromSuggestions(suggs.value);
  paso.value = 2;
}

/** Columnas que el usuario decidió importar (mapeadas a un campo). */
const columnasImportables = computed(() =>
  columns.value.filter((c) => mapping.value.some((m) => m.columnName === c.nombre)),
);

const camposSinMapear = computed(() =>
  props.schema.campos.filter(
    (f) => !mapping.value.some((m) => m.fieldId === f.id),
  ),
);

function setFieldColumn(fieldId: string, columnName: string) {
  mapping.value = mapping.value.filter((m) => m.fieldId !== fieldId);
  if (columnName) {
    mapping.value.push({ columnIndex: columns.value.findIndex((c) => c.nombre === columnName), columnName, fieldId });
  }
}

function sugerirParaCampo(fieldId: string): string {
  const field = props.schema.campos.find((f) => f.id === fieldId);
  if (!field) return '';
  const s = suggestColumnForField(columns.value, field);
  return s?.columnName ?? '';
}

function toggleColumna(colName: string, checked: boolean) {
  if (checked) {
    // Auto-mapear la columna al mejor campo libre
    const field = props.schema.campos.find(
      (f) => !mapping.value.some((m) => m.fieldId === f.id),
    );
    if (field) setFieldColumn(field.id, colName);
  } else {
    mapping.value = mapping.value.filter((m) => m.columnName !== colName);
  }
}

// ── Paso 3: validación (dry-run) ────────────────────────────────
const result = ref<DryRunResult | null>(null);
const importer = computed(() => new Importer(props.schema));

function goToPaso3() {
  if (!parsed.value) return;
  result.value = importer.value.dryRun(parsed.value, mapping.value);
  paso.value = 3;
}

const errores = computed(() => result.value?.issues.filter((i) => i.severity === 'error') ?? []);
const warnings = computed(() => result.value?.issues.filter((i) => i.severity === 'warning') ?? []);

// ── Paso 4: importar ────────────────────────────────────────────
const importando = ref(false);
const importado = ref(false);

async function confirmarImportacion() {
  if (!parsed.value || !result.value) return;
  importando.value = true;
  try {
    const filas = result.value.rows
      .filter((r) => !r.hasErrors)
      .map((r) => r.data);
    if (props.onImport) {
      await props.onImport(filas, result.value);
    }
    emit('imported', { filas, result: result.value });
    importado.value = true;
    paso.value = 4;
  } catch (err) {
    error.value = `Error al importar: ${(err as Error).message}`;
  } finally {
    importando.value = false;
  }
}

function reiniciar() {
  paso.value = 1;
  parsed.value = null;
  result.value = null;
  mapping.value = [];
  fileName.value = '';
  importado.value = false;
  error.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
</script>

<template>
  <div class="importador">
    <!-- Header -->
    <div class="imp-header">
      <div>
        <h3 class="imp-titulo">{{ titulo ?? 'Importar datos' }}</h3>
        <p v-if="descripcion" class="imp-desc">{{ descripcion }}</p>
      </div>
      <div class="imp-pasos" v-if="paso > 1">
        <span
          v-for="p in pasos"
          :key="p.n"
          class="imp-paso"
          :class="{ activo: paso === p.n, hecho: paso > p.n }"
        >
          {{ p.n }} · {{ p.label }}
        </span>
      </div>
    </div>

    <div v-if="error" class="imp-error">{{ error }}</div>

    <!-- ══ PASO 1: subir archivo ══ -->
    <div v-if="paso === 1" class="imp-panel">
      <div
        class="imp-drop"
        :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
        @click="fileInput?.click()"
      >
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.xls,.csv"
          class="imp-hidden"
          @change="onFileSelected"
        />
        <div class="imp-drop-icon">📄</div>
        <p class="imp-drop-text">
          <strong>Arrastra tu Excel o CSV aquí</strong><br />
          o haz clic para elegir archivo
        </p>
        <p class="imp-drop-sub">.xlsx · .xls · .csv</p>
      </div>

      <div v-if="sheetNamesList.length > 1" class="imp-hoja">
        <label>Hoja a importar</label>
        <select :value="sheetIndex" @change="onSheetChange(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(s, i) in sheetNamesList" :key="s" :value="i">{{ s }}</option>
        </select>
      </div>

      <div v-if="cargando" class="imp-cargando">Leyendo archivo…</div>
    </div>

    <!-- ══ PASO 2: mapeo ══ -->
    <div v-else-if="paso === 2" class="imp-panel">
      <div class="imp-filebar">
        📄 {{ fileName }}
        <button class="imp-link" @click="reiniciar">cambiar archivo</button>
      </div>

      <p class="imp-seccion-titulo">Columnas detectadas ({{ columns.length }})</p>
      <div class="imp-columnas">
        <label v-for="c in columns" :key="c.nombre" class="imp-columna">
          <input
            type="checkbox"
            :checked="mapping.some((m) => m.columnName === c.nombre)"
            @change="toggleColumna(c.nombre, ($event.target as HTMLInputElement).checked)"
          />
          <span class="imp-col-nombre">{{ c.nombre }}</span>
          <span class="imp-chip" :class="'tipo-' + c.tipoInferido">{{ c.tipoInferido }}</span>
          <span class="imp-col-ej">{{ c.ejemplos.slice(0, 2).join(', ') }}</span>
        </label>
      </div>

      <p class="imp-seccion-titulo">¿Contra qué campo va cada columna?</p>
      <div class="imp-mapeo">
        <div v-for="f in props.schema.campos" :key="f.id" class="imp-mapeo-fila">
          <div class="imp-mapeo-campo">
            <strong>{{ f.label }}</strong>
            <span v-if="f.requerido" class="imp-requerido">obligatorio</span>
            <small>{{ f.descripcion }}</small>
          </div>
          <select
            :value="mapping.find((m) => m.fieldId === f.id)?.columnName ?? ''"
            @change="setFieldColumn(f.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">— no importar —</option>
            <option
              v-for="c in columns"
              :key="c.nombre"
              :value="c.nombre"
            >
              {{ c.nombre }}
              <template v-if="sugerirParaCampo(f.id) === c.nombre">⭐</template>
            </option>
          </select>
        </div>
      </div>

      <div v-if="camposSinMapear.length" class="imp-aviso">
        ⚠️ Sin mapear: {{ camposSinMapear.map((f) => f.label).join(', ') }}
      </div>

      <div class="imp-acciones">
        <button class="imp-btn secundario" @click="reiniciar">Volver</button>
        <button class="imp-btn primario" :disabled="!columnasImportables.length" @click="goToPaso3">
          Validar ({{ columnasImportables.length }} columnas) →
        </button>
      </div>
    </div>

    <!-- ══ PASO 3: validación ══ -->
    <div v-else-if="paso === 3 && result" class="imp-panel">
      <div class="imp-resumen">
        <div class="imp-stat ok"><strong>{{ result.validRows }}</strong> válidas</div>
        <div class="imp-stat err"><strong>{{ result.errorRows }}</strong> con error</div>
        <div class="imp-stat warn"><strong>{{ warnings.length }}</strong> avisos</div>
      </div>

      <p class="imp-seccion-titulo">Primeras filas procesadas</p>
      <div class="imp-tabla-wrap">
        <table class="imp-tabla">
          <thead>
            <tr>
              <th>#</th>
              <th v-for="f in props.schema.campos" :key="f.id">{{ f.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in result.rows.slice(0, 10)" :key="i" :class="{ 'fila-error': row.hasErrors }">
              <td>{{ i + 2 }}</td>
              <td v-for="f in props.schema.campos" :key="f.id">
                {{ row.data[f.id] ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="errores.length" class="imp-errors">
        <p class="imp-seccion-titulo">Errores ({{ errores.length }})</p>
        <div v-for="(e, i) in errores.slice(0, 8)" :key="i" class="imp-error-fila">
          ⛔ Fila {{ e.rowNumber }}: {{ e.message }}
        </div>
      </div>

      <div v-if="result.unmappedColumns.length" class="imp-aviso">
        Columnas ignoradas: {{ result.unmappedColumns.join(', ') }}
      </div>

      <div class="imp-acciones">
        <button class="imp-btn secundario" @click="paso = 2">← Ajustar mapeo</button>
        <button
          class="imp-btn primario"
          :disabled="importando || result.validRows === 0"
          @click="confirmarImportacion"
        >
          {{ importando ? 'Importando…' : `Importar ${result.validRows} filas ✓` }}
        </button>
      </div>
    </div>

    <!-- ══ PASO 4: listo ══ -->
    <div v-else-if="paso === 4" class="imp-panel">
      <div class="imp-exito">
        <div class="imp-exito-icon">✅</div>
        <h3>¡Importación completada!</h3>
        <p>
          {{ result?.validRows }} filas importadas correctamente
          <template v-if="result?.errorRows"> · {{ result.errorRows }} filas con errores omitidas</template>
        </p>
        <button class="imp-btn primario" @click="reiniciar">Importar otro archivo</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.importador {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #1a1a2e;
  max-width: 860px;
  margin: 0 auto;
}
.imp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.imp-titulo { margin: 0; font-size: 1.15rem; font-weight: 650; }
.imp-desc { margin: 4px 0 0; color: #6b7280; font-size: 0.85rem; }
.imp-pasos { display: flex; gap: 6px; flex-wrap: wrap; }
.imp-paso { font-size: 0.72rem; padding: 4px 10px; border-radius: 999px; background: #f3f4f6; color: #9ca3af; }
.imp-paso.activo { background: #e0e7ff; color: #4338ca; font-weight: 600; }
.imp-paso.hecho { background: #d1fae5; color: #047857; }

.imp-panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.04); }
.imp-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px; border-radius: 10px; margin-bottom: 12px; font-size: 0.85rem; }

.imp-drop { border: 2px dashed #d1d5db; border-radius: 14px; padding: 36px 20px; text-align: center; cursor: pointer; transition: all 0.15s; }
.imp-drop.over, .imp-drop:hover { border-color: #6366f1; background: #f5f6ff; }
.imp-hidden { display: none; }
.imp-drop-icon { font-size: 2.2rem; margin-bottom: 8px; }
.imp-drop-text { margin: 0 0 6px; font-size: 0.95rem; }
.imp-drop-sub { margin: 0; color: #9ca3af; font-size: 0.8rem; }
.imp-hoja { margin-top: 14px; }
.imp-hoja label { font-size: 0.8rem; color: #6b7280; margin-right: 8px; }
.imp-hoja select, .imp-mapeo select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.85rem; background: #fff; }
.imp-cargando { margin-top: 12px; color: #6366f1; font-size: 0.85rem; text-align: center; }

.imp-filebar { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; }
.imp-link { background: none; border: none; color: #6366f1; cursor: pointer; font-size: 0.8rem; }

.imp-seccion-titulo { font-size: 0.85rem; font-weight: 600; color: #374151; margin: 18px 0 8px; }
.imp-columnas { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.imp-columna { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 0.82rem; cursor: pointer; }
.imp-columna:hover { border-color: #c7d2fe; }
.imp-col-nombre { font-weight: 600; }
.imp-chip { font-size: 0.65rem; padding: 2px 8px; border-radius: 999px; background: #f3f4f6; color: #6b7280; }
.imp-chip.tipo-fecha { background: #ede9fe; color: #6d28d9; }
.imp-chip.tipo-numero, .imp-chip.tipo-entero { background: #d1fae5; color: #047857; }
.imp-chip.tipo-telefono, .imp-chip.tipo-patente { background: #dbeafe; color: #1d4ed8; }
.imp-chip.tipo-email { background: #fce7f3; color: #be185d; }
.imp-col-ej { color: #9ca3af; font-size: 0.72rem; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.imp-mapeo { display: flex; flex-direction: column; gap: 8px; }
.imp-mapeo-fila { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 10px; }
.imp-mapeo-campo { display: flex; flex-direction: column; gap: 2px; }
.imp-mapeo-campo small { color: #9ca3af; font-size: 0.72rem; }
.imp-requerido { font-size: 0.62rem; color: #b45309; background: #fef3c7; padding: 1px 7px; border-radius: 999px; width: fit-content; }

.imp-aviso { margin-top: 12px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 0.8rem; padding: 8px 12px; border-radius: 8px; }
.imp-acciones { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.imp-btn { padding: 8px 16px; border-radius: 10px; border: none; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.imp-btn.primario { background: #4f46e5; color: #fff; }
.imp-btn.primario:hover:not(:disabled) { background: #4338ca; }
.imp-btn.primario:disabled { background: #c7d2fe; cursor: not-allowed; }
.imp-btn.secundario { background: #f3f4f6; color: #374151; }
.imp-btn.secundario:hover { background: #e5e7eb; }

.imp-resumen { display: flex; gap: 10px; margin-bottom: 6px; }
.imp-stat { flex: 1; text-align: center; padding: 14px; border-radius: 12px; font-size: 0.8rem; }
.imp-stat strong { display: block; font-size: 1.4rem; }
.imp-stat.ok { background: #ecfdf5; color: #047857; }
.imp-stat.err { background: #fef2f2; color: #b91c1c; }
.imp-stat.warn { background: #fffbeb; color: #b45309; }

.imp-tabla-wrap { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 10px; }
.imp-tabla { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.imp-tabla th { background: #f9fafb; text-align: left; padding: 8px 10px; color: #6b7280; font-weight: 600; white-space: nowrap; }
.imp-tabla td { padding: 7px 10px; border-top: 1px solid #f3f4f6; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imp-tabla tr.fila-error td { background: #fef2f2; }

.imp-errors { margin-top: 8px; }
.imp-error-fila { font-size: 0.78rem; color: #b91c1c; padding: 5px 0; }

.imp-exito { text-align: center; padding: 30px 0; }
.imp-exito-icon { font-size: 2.6rem; margin-bottom: 10px; }
.imp-exito h3 { margin: 0 0 6px; }
.imp-exito p { color: #6b7280; font-size: 0.88rem; margin: 0 0 18px; }
</style>
