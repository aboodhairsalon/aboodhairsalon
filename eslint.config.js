/**
 * ESLint flat config — Aboodhairsalon (single-tenant fork).
 *
 * Différences avec System A monorepo :
 *  - PAS d'import depuis @system-a/config — tout est inline ici
 *  - Garde les règles strictes (no-explicit-any, exhaustive-deps, etc.)
 *  - typedRoutes: support natif Next 15
 */
import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Strict TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // React hooks
      'react-hooks/exhaustive-deps': 'warn',
      // Imports
      'import/order': 'off', // Next handles via own plugin
    },
  },
  {
    // Ignore generated files
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'public/**',
      'src/db/types.ts', // Supabase-generated, has its own conventions
    ],
  },
];
