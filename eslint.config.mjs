/**
 * Phase-1 ESLint config.
 * Scope starts narrow: new baseline tests + runner only.
 * Expanding coverage is intentional follow-up work (see KNOWN-ISSUES K-20).
 */
import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.codex-p0a/**',
      'vendor/**',
      'docs/**',
      'assets/**',
      'branding/**',
      'templates/**',
      'build/**',
      'app-source/**',
      '01-ORIGINAL/**',
      '02-CURRENT/**',
      'src-stage5/**',
      'src-stage6/**',
      'stage-*-uat/**',
      'review-work/**',
      'pat-reports/**',
      '03-REPORTS/**',
      'cloud/**',
      'license/**',
      'migration/**',
      'import-studio/**',
      'index.html',
      'cupping-*.js',
      'import-engine-*.js',
      'electron/**',
      'scripts/**',
      'tools/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['tests/**/*.js', 'database/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
];
