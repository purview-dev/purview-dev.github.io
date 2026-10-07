import type { DiscoverableResource } from '../../src/lib/discovery/types';

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { documentedProjects, loadDiscoveryContext } from '../../src/lib/discovery/resources';
import { DISCOVERY_MANIFEST_SCHEMA_VERSION } from '../../src/lib/discovery/types';
import {
  DISCOVER_JSON_PATH,
  ROBOTS_PATH,
  SITEMAP_INDEX_PATH,
  isCanonicalUrl,
  projectLlmsFullUrl,
  projectLlmsUrl,
  projectPageUrl,
  siteOrigin,
  sitemapIndexUrl,
} from '../../src/lib/discovery/urls';
import { loadProjects } from '../../src/lib/manifest/load';

/**
 * `bun run discovery:validate`
 *
 * Post-build validation of the generated discovery artifacts. It fails CI for
 * genuine discovery errors (missing files, malformed XML, non-absolute or
 * off-origin URLs, duplicate canonicals, a robots.txt that does not advertise
 * the sitemap, a discover.json that references projects that do not exist, or
 * development URLs leaking into production output).
 */

const DEV_HOST_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i;
const LOC_PATTERN = /<loc>([^<]+)<\/loc>/g;
const LASTMOD_PATTERN = /<lastmod>([^<]+)<\/lastmod>/g;

function matches(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((match) => match[1] ?? '').filter(Boolean);
}

export interface DiscoveryValidationResult {
  errors: string[];
}

export interface DiscoveryValidationOptions {
  /**
   * Require the IndexNow key verification file (`/<INDEXNOW_KEY>.txt`) when
   * `INDEXNOW_KEY` is configured.
   *
   * The build never writes this file — it is written from the secret by the
   * deploy workflow via `bun run discovery:key`, *after* the build — so the
   * build pipeline (`just validate` / `ci:build`) cannot require it. Only the
   * deploy pipeline, which has just written the file, opts in with
   * `--require-indexnow-key`.
   */
  requireIndexNowKey?: boolean;
}

/**
 * Validate the IndexNow key verification file (`/<key>.txt`).
 *
 * Returns the error messages to report: empty when the key is unset/invalid
 * (nothing to check), when the file is present and correct, or when it is
 * absent and not required. `require` is only set by the deploy pipeline, which
 * writes the file after the build.
 */
export function validateIndexNowKeyFile(
  readFile: (path: string) => string | null,
  rawKey: string | undefined,
  options: { require?: boolean } = {},
): string[] {
  const key = rawKey?.trim();
  if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    return [];
  }
  const content = readFile(`/${key}.txt`);
  if (content === null) {
    return options.require
      ? ['INDEXNOW_KEY is configured but the key verification file is missing from the build.']
      : [];
  }
  if (content.trim() !== key) {
    return ['The IndexNow key verification file does not contain the configured key.'];
  }
  return [];
}

export function validateDiscovery(
  dist = resolve('dist'),
  options: DiscoveryValidationOptions = {},
): DiscoveryValidationResult {
  const errors: string[] = [];
  const fail = (message: string): void => {
    errors.push(message);
  };
  const origin = siteOrigin();

  const readDist = (path: string): string | null => {
    const file = resolve(dist, path.replace(/^\//, ''));
    if (!existsSync(file) || !statSync(file).isFile()) {
      return null;
    }
    return readFileSync(file, 'utf8');
  };
  const readDistByUrl = (url: string): string | null =>
    url.startsWith(origin) ? readDist(url.slice(origin.length)) : null;
  const scanForDevUrls = (label: string, content: string): void => {
    if (DEV_HOST_PATTERN.test(content)) {
      fail(`${label} contains a development URL (localhost/loopback).`);
    }
  };

  // --- sitemap index + children -------------------------------------------
  const indexXml = readDist(SITEMAP_INDEX_PATH);
  if (!indexXml) {
    fail(`Missing sitemap index: ${SITEMAP_INDEX_PATH}`);
  }
  const childLocs = indexXml ? matches(indexXml, LOC_PATTERN) : [];
  if (indexXml && !/<sitemapindex\b/.test(indexXml)) {
    fail('sitemap-index.xml is not a <sitemapindex> document.');
  }
  if (indexXml && childLocs.length < 3) {
    fail(`sitemap-index.xml lists ${childLocs.length} child sitemap(s); expected at least 3.`);
  }

  const seenCanonical = new Map<string, string>();
  for (const child of childLocs) {
    if (!isCanonicalUrl(child, origin)) {
      fail(`Sitemap child is not on ${origin}: ${child}`);
      continue;
    }
    const childXml = readDistByUrl(child);
    if (!childXml) {
      fail(`Sitemap index references a missing child sitemap: ${child}`);
      continue;
    }
    if (!/<urlset\b/.test(childXml)) {
      fail(`Child sitemap is not a <urlset> document: ${child}`);
    }
    scanForDevUrls(child, childXml);

    const urls = matches(childXml, LOC_PATTERN);
    if (urls.length === 0) {
      fail(`Child sitemap has no <loc> entries: ${child}`);
    }
    for (const url of urls) {
      if (!isCanonicalUrl(url, origin)) {
        fail(`Sitemap URL is not absolute or off-origin (${origin}): ${url}`);
      }
      const previous = seenCanonical.get(url);
      if (previous) {
        fail(`Duplicate canonical URL in sitemaps: ${url} (in ${previous} and ${child})`);
      } else {
        seenCanonical.set(url, child);
      }
    }
    for (const lastmod of matches(childXml, LASTMOD_PATTERN)) {
      if (Number.isNaN(Date.parse(lastmod))) {
        fail(`Invalid <lastmod> value "${lastmod}" in ${child}`);
      }
    }
  }

  // --- robots.txt ----------------------------------------------------------
  const robots = readDist(ROBOTS_PATH);
  if (!robots) {
    fail(`Missing robots.txt: ${ROBOTS_PATH}`);
  } else {
    scanForDevUrls('robots.txt', robots);
    if (!robots.includes(`Sitemap: ${sitemapIndexUrl()}`)) {
      fail(`robots.txt does not reference the production sitemap: ${sitemapIndexUrl()}`);
    }
    if (!/User-agent:\s*\*/i.test(robots)) {
      fail('robots.txt does not contain a "User-agent: *" section.');
    }
    if (!/User-agent:\s*OAI-SearchBot/i.test(robots)) {
      fail('robots.txt does not explicitly permit OAI-SearchBot.');
    }
    if (!/User-agent:\s*QwantBot/i.test(robots)) {
      fail('robots.txt does not explicitly permit QwantBot.');
    }
  }

  // --- root llms files -----------------------------------------------------
  // Note: the LLM bundles are documentation content and may legitimately show
  // `localhost` examples, so the development-URL scan is applied only to the
  // machine-readable discovery artifacts (sitemaps, robots, discover.json).
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    const content = readDist(path);
    if (content === null) {
      fail(`Missing ${path}`);
    } else if (content.trim().length === 0) {
      fail(`${path} is empty.`);
    }
  }

  // --- discover.json -------------------------------------------------------
  const discover = readDist(DISCOVER_JSON_PATH);
  if (!discover) {
    fail(`Missing discover.json: ${DISCOVER_JSON_PATH}`);
  } else {
    scanForDevUrls('discover.json', discover);
    try {
      const manifest = JSON.parse(discover) as {
        schemaVersion?: number;
        resources?: DiscoverableResource[];
        projects?: {
          slug?: string;
          url?: string;
          llms?: { summary?: string; full?: string } | null;
        }[];
      };
      if (manifest.schemaVersion !== DISCOVERY_MANIFEST_SCHEMA_VERSION) {
        fail('discover.json has an unexpected schemaVersion.');
      }
      if (!Array.isArray(manifest.resources)) {
        fail('discover.json is missing the resources array.');
      }
      const projectIds = new Set(loadProjects().map((project) => project.id));
      for (const project of manifest.projects ?? []) {
        const slug = project.slug ?? '';
        if (!projectIds.has(slug)) {
          fail(`discover.json references an unknown project: ${slug}`);
          continue;
        }
        if (project.url && project.url !== projectPageUrl(slug)) {
          fail(`discover.json project URL does not match the canonical page: ${project.url}`);
        }
        for (const url of [project.llms?.summary, project.llms?.full]) {
          if (url && !isCanonicalUrl(url, origin)) {
            fail(`discover.json project LLM URL is off-origin: ${url}`);
          }
        }
      }
    } catch {
      fail('discover.json is not valid JSON.');
    }
  }

  // --- per-project llms resources -----------------------------------------
  for (const project of documentedProjects(loadDiscoveryContext())) {
    for (const url of [projectLlmsUrl(project.id), projectLlmsFullUrl(project.id)]) {
      const content = readDistByUrl(url);
      if (content === null) {
        fail(`Missing per-project LLM resource: ${url}`);
      } else if (content.trim().length === 0) {
        fail(`Per-project LLM resource is empty: ${url}`);
      }
    }
  }

  // --- IndexNow key file --------------------------------------------------
  // The build never writes this file (the key is a deploy-only secret), so its
  // presence is only required when the caller opts in — the deploy workflow
  // runs this after `discovery:key`. When the file is present it must always
  // contain the configured key.
  for (const error of validateIndexNowKeyFile(readDist, process.env.INDEXNOW_KEY, {
    require: options.requireIndexNowKey,
  })) {
    fail(error);
  }

  return { errors };
}

if (import.meta.main) {
  console.log('Validating discovery artifacts...');
  const requireIndexNowKey = process.argv.includes('--require-indexnow-key');
  const { errors } = validateDiscovery(resolve('dist'), { requireIndexNowKey });
  if (errors.length > 0) {
    console.error(`Discovery validation failed with ${errors.length} issue(s):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.log('Discovery validation passed.');
}
