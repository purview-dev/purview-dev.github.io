import { glob } from 'fast-glob';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DOCS_MANIFEST_SCHEMA, DOCS_CACHE_DIR } from '../src/lib/docs/aggregate';
import { isReleaseCache, readReleaseCache } from '../src/lib/releases/cache';

const DIST = resolve('dist');

const SECRET_PATTERNS = [
  /\bghp_[A-Za-z0-9]{36,}\b/,
  /\bgho_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bNUGET__APIKEY\s*[:=]\s*\S+/i,
];

const LOCAL_PATH_PATTERNS = [
  /[A-Za-z]:\\[^\s"']+/, // Windows absolute paths
  /\/Users\/[^\s"']+/, // macOS home paths (case-sensitive)
  /\/home\/[A-Za-z0-9._-]+\//, // Linux home paths
  /\.cache[/\\]/,
  /node_modules[/\\]/,
];

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
  console.error(`  ✗ ${message}`);
}

function validateDocsManifest(): void {
  const file = join(DOCS_CACHE_DIR, 'index.json');
  if (!existsSync(file)) {
    console.warn('  (no docs manifest cache present — skipping docs cache validation)');
    return;
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const candidate = parsed as Record<string, unknown>;
  if (candidate.schema !== DOCS_MANIFEST_SCHEMA) {
    fail(`Docs manifest has unexpected schema version: ${String(candidate.schema)}`);
    return;
  }
  const projects = candidate.projects;
  if (!Array.isArray(projects)) {
    fail('Docs manifest is missing the projects array.');
  }
}

function validateReleaseCache(): void {
  const cached = readReleaseCache();
  if (!cached) {
    console.warn('  (no release cache present — skipping release cache validation)');
    return;
  }
  if (!isReleaseCache(cached)) {
    fail('Release cache failed structural validation.');
  }
}

function requireDistFile(file: string): void {
  const path = resolve(DIST, file);
  if (!existsSync(path)) {
    fail(`Missing required build output: ${file}`);
    return;
  }
  const content = readFileSync(path, 'utf8');
  if (content.trim() === '') {
    fail(`Required build output is empty: ${file}`);
  }
}

async function scanForSecrets(): Promise<void> {
  const files = await glob('**/*', { cwd: DIST, onlyFiles: true });
  for (const file of files) {
    const path = resolve(DIST, file);
    if (!statSync(path).isFile()) {
      continue;
    }
    const content = readFileSync(path, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        fail(`Possible secret pattern in built output: ${file}`);
        break;
      }
    }
    if (/\.(?:html|txt)$/.test(file)) {
      for (const pattern of LOCAL_PATH_PATTERNS) {
        if (pattern.test(content)) {
          fail(`Local path pattern in built output: ${file}`);
          break;
        }
      }
    }
  }
}

async function run(): Promise<number> {
  console.log('Checking generated data and build outputs...');
  validateDocsManifest();
  validateReleaseCache();

  if (!existsSync(DIST)) {
    console.error('\n  dist/ is missing. Run `just build` before check-generated.');
    return errors.length > 0 ? 1 : 2;
  }

  requireDistFile('llms.txt');
  requireDistFile('llms-small.txt');
  requireDistFile('llms-full.txt');
  requireDistFile('sitemap-index.xml');
  requireDistFile('robots.txt');

  const llmsFull = readFileSync(resolve(DIST, 'llms-full.txt'), 'utf8');
  const llms = readFileSync(resolve(DIST, 'llms.txt'), 'utf8');
  if (
    !llms.includes('https://purview.dev') &&
    !llms.includes(process.env.SITE_URL ?? 'https://purview.dev')
  ) {
    fail('llms.txt does not reference the canonical site URL.');
  }
  if (llmsFull.trim().length < 500) {
    fail('llms-full.txt appears too small to be useful.');
  }

  await scanForSecrets();

  if (errors.length > 0) {
    console.error(`\nGenerated-output check failed with ${errors.length} issue(s).`);
    return 1;
  }
  console.log('Generated-output check passed.');
  return 0;
}

if (import.meta.main) {
  process.exit(await run());
}
