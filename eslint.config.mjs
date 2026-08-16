// Flat ESLint config.
//
// `next lint` was removed in Next 16, so the old `"lint": "next lint"` script had been failing
// with "Invalid project directory provided: .../lint" — the admin panel had no working lint step
// at all (CI included, if it runs this). eslint-config-next 15.x still ships only legacy .eslintrc
// configs, so FlatCompat bridges them into ESLint 9's flat format.
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
      'supabase/migrations/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
]

export default config
