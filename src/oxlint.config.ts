import { defineConfig } from 'oxlint';

export default defineConfig({
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    perf: 'warn',
  },
  plugins: ['typescript', 'react', 'unicorn', 'oxc', 'import', 'jest', 'jsx-a11y'],
  env: {
    browser: true,
    node: true,
    es2024: true,
  },
  options: {
    maxWarnings: 0,
  },
  rules: {
    'no-debugger': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    // Preact uses an automatic JSX runtime; the rule's React requirement is noise.
    'react/react-in-jsx-scope': 'off',
    // Release/docs fetching is intentionally sequential to stay inside API
    // rate limits; Promise.all would only help if requests were independent.
    'eslint/no-await-in-loop': 'off',
    // CSS side-effect imports (`import '~/styles/global.css'`) are standard.
    'import/no-unassigned-import': 'off',
  },
  overrides: [
    {
      files: ['oxfmt.config.ts', 'oxlint.config.ts'],
      rules: {
        'import/no-default-export': 'off',
      },
    },
    {
      // CLI tools legitimately log progress and results.
      files: ['scripts/**/*.ts', 'astro.config.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.{test,spec}.{ts,tsx}'],
      env: { jest: true },
      rules: { 'no-console': 'off' },
    },
    {
      files: ['**/*.astro'],
      env: { browser: true },
    },
  ],
});
