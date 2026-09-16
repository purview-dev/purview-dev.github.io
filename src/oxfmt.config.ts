import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  endOfLine: 'lf',
  insertFinalNewline: true,
  sortImports: {
    groups: [
      'type',
      'side_effect_style',
      'side_effect',
      'style',
      ['builtin', 'external'],
      ['internal', 'subpath'],
      ['parent', 'sibling', 'index'],
      'unknown',
    ],
    internalPattern: ['~/', '@/', '#'],
    ignoreCase: true,
  },
  sortTailwindcss: true,
  sortPackageJson: { sortScripts: true },
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.astro/**',
    '.cache/**',
    'src/content/docs/**',
    'src/assets/branding/**',
    'public/branding/**',
    'fixtures/**',
    'tests/fixtures/**',
  ],
  overrides: [
    {
      files: ['*.md', '*.mdx'],
      options: {
        proseWrap: 'preserve',
      },
    },
  ],
});
