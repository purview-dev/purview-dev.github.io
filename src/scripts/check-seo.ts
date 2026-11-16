import type { DiscoverableResource } from '../src/lib/discovery/types';

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DISCOVER_JSON_PATH } from '../src/lib/discovery/urls';
import { loadProjects } from '../src/lib/manifest/load';
import { productName } from '../src/lib/seo';

/**
 * `bun run check:seo`
 *
 * The SEO invariants the *built site* must keep, checked against the real output
 * rather than against the code that produced it:
 *
 * - every indexable URL has exactly one `<h1>`, a self-referencing canonical, a
 *   non-empty `<title>` and a non-empty `<meta name="description">`;
 * - `<title>`s are unique, and every aggregated documentation page names its
 *   project (a docs title that omits the product is unreachable from a search
 *   for that product — see `lib/seo`);
 * - every JSON-LD block on a documentation or project page parses;
 * - an indexable URL never carries `noindex`.
 *
 * Length guidance is reported as an *advisory*, never a failure: a title of 80
 * characters is a judgement call, and a check that fails on taste gets weakened
 * (ADR 0001). A missing title is not a judgement call.
 */

export interface SeoIssue {
  url: string;
  message: string;
}

export interface SeoReport {
  errors: SeoIssue[];
  advisories: SeoIssue[];
  /** Indexable URLs examined. */
  pages: number;
}

/** Advisory ceiling: search engines truncate around here. */
const TITLE_ADVISORY = 70;
const DESCRIPTION_ADVISORY_MIN = 70;
const DESCRIPTION_ADVISORY_MAX = 175;

/** How many advisories to print before summarising the rest. */
const ADVISORY_SAMPLE = 10;

const TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const H1_PATTERN = /<h1[\s>]/gi;
const CANONICAL_PATTERN = /<link[^>]+rel=["']canonical["'][^>]*>/i;
const HREF_PATTERN = /href=["']([^"']+)["']/i;
const JSONLD_PATTERN = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Decode the entities the site's own templates emit in titles. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function extractTitle(html: string): string | null {
  const match = TITLE_PATTERN.exec(html);
  return match?.[1] === undefined ? null : decodeEntities(match[1]);
}

/**
 * Read one attribute from a tag, honouring the quote that delimits it.
 *
 * A naive `[^"']+` stops at an apostrophe inside the value, which silently
 * truncates any description containing one ("Purview's …" became "Purview"), so
 * the delimiter is matched exactly.
 */
export function readAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2];
}

/** All `<meta>` tags with the given attribute, as `attrValue -> content` maps. */
export function extractMeta(html: string, attribute: 'name' | 'property'): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = readAttribute(tag, attribute)?.toLowerCase();
    const content = readAttribute(tag, 'content');
    if (key !== undefined && key !== '' && content !== undefined && !result.has(key)) {
      result.set(key, decodeEntities(content));
    }
  }
  return result;
}

export function extractCanonical(html: string): string | null {
  const tag = CANONICAL_PATTERN.exec(html)?.[0];
  if (tag === undefined) {
    return null;
  }
  return HREF_PATTERN.exec(tag)?.[1] ?? null;
}

export function countH1(html: string): number {
  return [...html.matchAll(H1_PATTERN)].length;
}

/** Parsed JSON-LD payloads; `null` marks a block that is not valid JSON. */
export function extractJsonLd(html: string): (unknown | null)[] {
  const blocks: (unknown | null)[] = [];
  for (const match of html.matchAll(JSONLD_PATTERN)) {
    try {
      blocks.push(JSON.parse(match[1] ?? ''));
    } catch {
      blocks.push(null);
    }
  }
  return blocks;
}

/** The `dist` file a canonical site path is published as. */
export function distFileForPath(dist: string, pathname: string): string {
  const clean = pathname.replace(/^\//, '').replace(/\/$/, '');
  return clean === '' ? join(dist, 'index.html') : join(dist, ...clean.split('/'), 'index.html');
}

/**
 * Every documented project's URL prefix, with the names a docs page title may
 * use to identify it: the catalogue display name and the product (package) name.
 */
function documentationTargets(): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const project of loadProjects()) {
    if (!project.docs || project.status === 'archived') {
      continue;
    }
    const names = [project.name, productName(project)].filter((name) => name !== '');
    targets.set(`/docs/${project.id}/`, names);
  }
  return targets;
}

export function checkSeo(dist = resolve('dist')): SeoReport {
  const errors: SeoIssue[] = [];
  const advisories: SeoIssue[] = [];
  const discoverFile = join(dist, DISCOVER_JSON_PATH.replace(/^\//, ''));
  if (!existsSync(discoverFile)) {
    return {
      errors: [{ url: DISCOVER_JSON_PATH, message: 'discover.json is missing; run `just build`.' }],
      advisories: [],
      pages: 0,
    };
  }

  let resources: DiscoverableResource[] = [];
  try {
    const manifest = JSON.parse(readFileSync(discoverFile, 'utf8')) as {
      resources?: DiscoverableResource[];
    };
    resources = manifest.resources ?? [];
  } catch {
    return {
      errors: [{ url: DISCOVER_JSON_PATH, message: 'discover.json is not valid JSON.' }],
      advisories: [],
      pages: 0,
    };
  }

  // The machine-readable bundles are text files with no head of their own.
  const indexable = resources.filter(
    (resource) => resource.indexable && !new URL(resource.url).pathname.endsWith('.txt'),
  );
  const docsPrefixes = documentationTargets();
  const titles = new Map<string, string>();
  let pages = 0;

  for (const resource of indexable) {
    const pathname = new URL(resource.url).pathname;
    const file = distFileForPath(dist, pathname);
    if (!existsSync(file)) {
      errors.push({ url: resource.url, message: 'indexable URL has no built page.' });
      continue;
    }
    pages += 1;
    const html = readFileSync(file, 'utf8');
    const title = extractTitle(html);
    const description = extractMeta(html, 'name').get('description') ?? '';
    const canonical = extractCanonical(html);
    const h1 = countH1(html);

    if (h1 !== 1) {
      errors.push({ url: resource.url, message: `expected exactly one <h1>, found ${h1}.` });
    }
    if (title === null || title === '') {
      errors.push({ url: resource.url, message: 'the page has no <title>.' });
    } else {
      const existing = titles.get(title);
      if (existing !== undefined) {
        errors.push({
          url: resource.url,
          message: `duplicate <title> — also used by ${existing}.`,
        });
      } else {
        titles.set(title, resource.url);
      }
      if (title.length > TITLE_ADVISORY) {
        advisories.push({
          url: resource.url,
          message: `title is ${title.length} characters (search engines truncate around ${TITLE_ADVISORY}).`,
        });
      }
    }
    if (description === '') {
      errors.push({ url: resource.url, message: 'the page has no <meta name="description">.' });
    } else if (
      description.length < DESCRIPTION_ADVISORY_MIN ||
      description.length > DESCRIPTION_ADVISORY_MAX
    ) {
      advisories.push({
        url: resource.url,
        message: `description is ${description.length} characters (aim for ${DESCRIPTION_ADVISORY_MIN}-${DESCRIPTION_ADVISORY_MAX}).`,
      });
    }
    if (canonical === null) {
      errors.push({ url: resource.url, message: 'the page has no canonical link.' });
    } else if (canonical !== resource.url) {
      errors.push({ url: resource.url, message: `canonical points elsewhere: ${canonical}.` });
    }
    if (extractMeta(html, 'name').get('robots')?.includes('noindex') === true) {
      errors.push({ url: resource.url, message: 'an indexable URL is marked noindex.' });
    }

    // A documentation page must say which project it documents.
    for (const [prefix, names] of docsPrefixes) {
      if (!pathname.startsWith(prefix) || names.length === 0) {
        continue;
      }
      if (title !== null && !names.some((name) => title.includes(name))) {
        errors.push({
          url: resource.url,
          message: `documentation title does not name the project (expected "${names.join('" or "')}"): ${title}`,
        });
      }
      break;
    }

    const isProjectOrDocs = pathname.startsWith('/docs/') || pathname.startsWith('/projects/');
    const jsonLd = extractJsonLd(html);
    jsonLd.forEach((block, index) => {
      if (block === null) {
        errors.push({
          url: resource.url,
          message: `JSON-LD block ${index + 1} is not valid JSON.`,
        });
      }
    });
    if (isProjectOrDocs && jsonLd.length === 0) {
      errors.push({ url: resource.url, message: 'no JSON-LD structured data on the page.' });
    }
  }

  return { errors, advisories, pages };
}

if (import.meta.main) {
  console.log('Checking search-engine metadata in the built site...');
  const { errors, advisories, pages } = checkSeo(resolve('dist'));
  for (const error of errors) {
    console.error(`  ✗ ${error.url}: ${error.message}`);
  }
  if (advisories.length > 0) {
    // Advisories are guidance, not failures: they are summarised with a sample so
    // a genuine error is never buried under a hundred length notes.
    const shown = advisories.slice(0, ADVISORY_SAMPLE);
    for (const advisory of shown) {
      console.warn(`  ⚠ ${advisory.url}: ${advisory.message}`);
    }
    const hidden = advisories.length - shown.length;
    const titleNotes = advisories.filter((note) => note.message.startsWith('title')).length;
    const descriptionNotes = advisories.length - titleNotes;
    console.warn(
      `  ⚠ ${advisories.length} advisory note(s): ${titleNotes} title length, ` +
        `${descriptionNotes} description length` +
        (hidden > 0 ? ` — showing the first ${shown.length}` : ''),
    );
  }
  if (errors.length > 0) {
    console.error(`\nSEO check failed with ${errors.length} issue(s) across ${pages} page(s).`);
    process.exit(1);
  }
  console.log(
    `SEO check passed: ${pages} indexable page(s), ${advisories.length} advisory note(s).`,
  );
}
