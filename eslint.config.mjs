import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['apps/web/public/maplibre-gl-worker.mjs', '**/node_modules/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**', '**/public/sw.js', '**/public/push-sw.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Atomics: "readonly", Int32Array: "readonly", SharedArrayBuffer: "readonly" } },
  },
];
