<script setup lang="ts">
import { ref } from 'vue';
import { ImportStepper } from '@importador/vue';
import { schemaOTs } from '@importador/core';

const handledRows = ref<number>(0);

function demoImport(filas: Array<Record<string, unknown>>) {
  // Demo: no persiste nada, solo cuenta. En una app real, aquí se
  // insertaría en la BD (p.ej. Supabase) con las filas ya transformadas.
  handledRows.value = filas.length;
  console.log('[demo] filas listas para importar:', filas);
}
</script>

<template>
  <div class="page">
    <h1>🧮 Importador inteligente</h1>
    <p class="sub">
      Detecta columnas de tu Excel/CSV, sugiere el mapeo contra un schema declarativo
      y valida antes de importar. Probá con <code>FICHA CLIENTES.xlsx</code> o cualquier CSV.
    </p>

    <div class="demo-note">
      💡 <strong>Demo local:</strong> descargá el archivo de ejemplo
      <a href="/FICHA_CLIENTES.xlsx" download>FICHA_CLIENTES.xlsx</a> y probá el flujo completo.
    </div>

    <ImportStepper
      :schema="schemaOTs"
      titulo="Importar órdenes de trabajo"
      descripcion="Schema 'ots' — mapea columnas del Excel histórico del taller"
      :on-import="demoImport"
    />

    <p v-if="handledRows > 0" class="sub" style="margin-top: 16px">
      ✅ {{ handledRows }} filas pasaron la validación (demo, no se guardó nada)
    </p>
  </div>
</template>

<style>
code { background: #eef2ff; padding: 2px 6px; border-radius: 6px; font-size: 0.85em; }
</style>
