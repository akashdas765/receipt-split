import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.netlify/**', '.vercel/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
      'react-refresh/only-export-components': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Flags the ordinary "load data on mount" effect pattern used
      // throughout this app (see HomePage/DetailPage) as an error — too
      // aggressive for this codebase's style, not an actual bug here.
      'react-hooks/set-state-in-effect': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['netlify/functions/**/*.js', 'api/**/*.js', 'shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
