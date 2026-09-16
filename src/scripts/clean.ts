import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = [
  'dist',
  '.astro',
  '.cache',
  'node_modules',
  'src/content/docs',
  'public/branding',
  'public/favicon.svg',
  'public/favicon-16.png',
  'public/favicon-32.png',
  'public/apple-touch-icon.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/og',
];

if (import.meta.main) {
  for (const target of TARGETS) {
    const path = resolve(target);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      console.log(`Removed ${target}`);
    }
  }
}
