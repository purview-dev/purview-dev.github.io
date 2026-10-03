import { glob } from 'fast-glob';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

import { LOCAL_PATH_PATTERNS, SECRET_PATTERNS } from '../src/lib/build-paths';
import {
  DOCS_CACHE_DIR,
  DOCS_MANIFEST_SCHEMA,
  DOCS_OUTPUT_DIR,
  readDocsManifest,
} from '../src/lib/docs/aggregate';
import { extractDescription } from '../src/lib/docs/frontmatter';
import { loadProjects } from '../src/lib/manifest/load';
import { isReleaseCache, readReleaseCache } from '../src/lib/releases/cache';

const DIST = resolve('dist');

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
  console.error(`  ✗ ${message}`);
}

function inspectMarkdownStructure(markdown: string): {
  titleCount: number;
  unclosedFence: boolean;
} {
  let titleCount = 0;
  let fence: '```' | '~~~' | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1] as '```' | '~~~';
      fence = fence === marker ? null : (fence ?? marker);
    } else if (!fence && /^#\s+\S/.test(line)) {
      titleCount += 1;
    }
  }
  return { titleCount, unclosedFence: fence !== null };
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

/**
 * The docs manifest drives the Starlight sidebar while the generated mirror
 * under `src/content/docs/` provides the pages it links to. They are written by
 * the same sync, so a mismatch means the sync was interrupted — Starlight would
 * then fail with `The slug "docs/<project>/<page>" specified in the Starlight
 * sidebar config does not exist`.
 */
function validateDocsMirror(): void {
  const manifest = readDocsManifest();
  if (!manifest) {
    console.warn('  (no docs manifest present — skipping docs mirror validation)');
    return;
  }
  const mirrorRoot = join(DOCS_OUTPUT_DIR, 'docs');
  if (!existsSync(mirrorRoot)) {
    console.warn('  (no docs mirror present — skipping docs mirror validation)');
    return;
  }

  const expected = new Set<string>();
  for (const project of manifest.projects) {
    for (const page of project.pages) {
      expected.add(`${project.projectId}/${page.slug}`);
      if (!existsSync(join(mirrorRoot, project.projectId, `${page.slug}.md`))) {
        fail(
          `Docs manifest lists a page with no mirror file: docs/${project.projectId}/${page.slug}. ` +
            'The Starlight sidebar would link to a missing page — re-run `just data-sync`.',
        );
      }
    }
  }

  for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const page of readdirSync(join(mirrorRoot, entry.name))) {
      if (page.endsWith('.md') && !expected.has(`${entry.name}/${page.slice(0, -3)}`)) {
        fail(
          `Docs mirror page is missing from the manifest: docs/${entry.name}/${page}. ` +
            'Re-run `just data-sync` so the sidebar and content agree.',
        );
      }
      if (!page.endsWith('.md')) {
        continue;
      }

      const relativePath = `docs/${entry.name}/${page}`;
      const markdown = readFileSync(join(mirrorRoot, entry.name, page), 'utf8');
      const frontmatterMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(markdown);
      if (!frontmatterMatch?.[1] || frontmatterMatch[2] === undefined) {
        fail(`Generated Markdown has invalid front matter: ${relativePath}.`);
        continue;
      }

      let frontmatter: Record<string, unknown>;
      try {
        frontmatter = parse(frontmatterMatch[1]) as Record<string, unknown>;
      } catch {
        fail(`Generated Markdown front matter is not valid YAML: ${relativePath}.`);
        continue;
      }

      const body = frontmatterMatch[2];
      const description = String(frontmatter.description ?? '').trim();
      if (!description || description === '---' || !/[A-Za-z0-9]/.test(description)) {
        fail(`Generated Markdown has an unreadable description: ${relativePath}.`);
      }
      if (!extractDescription(body)) {
        fail(`Generated Markdown has no readable prose: ${relativePath}.`);
      }
      const { titleCount, unclosedFence } = inspectMarkdownStructure(body);
      if (titleCount !== 1) {
        fail(`Generated Markdown must contain exactly one H1: ${relativePath} (${titleCount}).`);
      }
      if (unclosedFence) {
        fail(`Generated Markdown has an unclosed fenced block: ${relativePath}.`);
      }
      if (body.includes('<doclink:')) {
        fail(`Generated Markdown contains an unresolved documentation link: ${relativePath}.`);
      }
    }
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

/**
 * Per-project `llms.txt` bundles are emitted by the discovery integration at
 * `/projects/<project-id>/llms.txt` and `/projects/<project-id>/llms-full.txt`.
 * The project pages, the project documentation overview, and the documentation
 * portal all link to these paths, so a missing bundle is a broken link — and the
 * link crawl only sees the pages that link it.
 */
function validateProjectLlmsBundles(): void {
  const projects = loadProjects().filter(
    (project) => project.docs && project.status !== 'archived',
  );
  for (const project of projects) {
    requireDistFile(`projects/${project.id}/llms.txt`);
    requireDistFile(`projects/${project.id}/llms-full.txt`);
  }

  const entrypointPath = resolve(DIST, 'llms.txt');
  if (!existsSync(entrypointPath)) {
    return;
  }
  const entrypoint = readFileSync(entrypointPath, 'utf8');
  for (const project of projects) {
    if (!entrypoint.includes(`/projects/${project.id}/llms.txt`)) {
      fail(`llms.txt does not link the per-project bundle for "${project.id}".`);
    }
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
  validateDocsMirror();
  validateReleaseCache();

  if (!existsSync(DIST)) {
    console.error('\n  dist/ is missing. Run `just build` before check-generated.');
    return errors.length > 0 ? 1 : 2;
  }

  requireDistFile('llms.txt');
  requireDistFile('llms-small.txt');
  requireDistFile('llms-full.txt');
  requireDistFile('sitemap-index.xml');
  requireDistFile('sitemaps/pages.xml');
  requireDistFile('sitemaps/projects.xml');
  requireDistFile('sitemaps/llms.xml');
  requireDistFile('discover.json');
  requireDistFile('robots.txt');

  validateProjectLlmsBundles();

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
