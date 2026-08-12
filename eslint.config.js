// ESLint 9 flat config para el monorepo del importador.
// TypeScript estricto + Prettier (reglas de formato delegadas).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'examples/demo-vue/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // El motor usa mucho `any` controlado para valores crudos de Excel/CSV
      '@typescript-eslint/no-explicit-any': 'warn',
      // Callbacks async que devuelven promesas: permitido
      '@typescript-eslint/no-misused-promises': 'off',
      // Preferir const cuando no se reasigna (Clean Code)
      'prefer-const': 'warn',
      // Evitar else tras return (early return)
      'no-else-return': 'warn',
    },
  },
  prettier,
);
