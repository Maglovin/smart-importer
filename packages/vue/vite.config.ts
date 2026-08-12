import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ImportadorVue',
      fileName: 'importador-vue',
    },
    rollupOptions: {
      external: ['vue', '@importador/core'],
      output: {
        globals: {
          vue: 'Vue',
          '@importador/core': 'ImportadorCore',
        },
      },
    },
  },
});
