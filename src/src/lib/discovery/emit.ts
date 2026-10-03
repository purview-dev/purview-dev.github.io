import type { DiscoveryContext, SitemapPartition } from './resources';
import type { DiscoverableResource } from './types';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DOCS_OUTPUT_DIR } from '../docs/aggregate';
import {
  buildDeploymentState,
  buildDiscoveryManifest,
  buildManifestProjects,
  serializeJson,
} from './manifest';
import { renderProjectLlms, renderProjectLlmsFull } from './project-llms';
import {
  buildResources,
  documentedProjects,
  loadDiscoveryContext,
  normalizePagePath,
  partitionResources,
} from './resources';
import { renderRobotsTxt } from './robots';
import { latestLastmod, renderSitemapIndex, renderUrlset } from './sitemap';
import { SITEMAP_INDEX_PATH, sitemapLlmsUrl, sitemapPagesUrl, sitemapProjectsUrl } from './urls';

/**
 * Emit every discovery artifact from the discovery model. Shared by the Astro
 * integration (which passes Astro's real page list) and the `discovery:manifest`
 * CLI (which reconstructs the page list from an existing `dist/`), so the two
 * can never diverge.
 */

export interface DiscoveryLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface EmitOptions {
  /** Absolute path to the build output directory. */
  dist: string;
  /** Astro pathnames (e.g. `''`, `about/`, `docs/zodsharp/core-concepts/`). */
  pagePaths: readonly string[];
  logger?: DiscoveryLogger;
  context?: DiscoveryContext;
}

export interface EmitResult {
  resources: DiscoverableResource[];
  partition: SitemapPartition;
}

const silentLogger: DiscoveryLogger = { info: () => {}, warn: () => {} };

export function emitDiscoveryArtifacts(options: EmitOptions): EmitResult {
  const logger = options.logger ?? silentLogger;
  const ctx = options.context ?? loadDiscoveryContext();
  const generatedAt = new Date().toISOString();

  const pagePaths = [...options.pagePaths];
  if (!pagePaths.some((path) => normalizePagePath(path) === '')) {
    pagePaths.push('');
  }

  const resources = buildResources(pagePaths, ctx);
  const partition = partitionResources(resources);

  const write = (relative: string, content: string): void => {
    const target = join(options.dist, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };

  write('sitemaps/pages.xml', renderUrlset(partition.pages));
  write('sitemaps/projects.xml', renderUrlset(partition.projects));
  write('sitemaps/llms.xml', renderUrlset(partition.llms));
  write(
    SITEMAP_INDEX_PATH.replace(/^\//, ''),
    renderSitemapIndex([
      { loc: sitemapPagesUrl(), lastmod: latestLastmod(partition.pages) },
      { loc: sitemapProjectsUrl(), lastmod: latestLastmod(partition.projects) },
      { loc: sitemapLlmsUrl(), lastmod: latestLastmod(partition.llms) },
    ]),
  );

  write('robots.txt', renderRobotsTxt());

  const manifest = buildDiscoveryManifest({
    resources,
    projects: buildManifestProjects(ctx.projects, ctx.releaseData, ctx.dataSource),
    generatedAt,
  });
  write('discover.json', serializeJson(manifest));

  for (const project of documentedProjects(ctx)) {
    const manifestEntry = ctx.docsManifest?.projects.find(
      (entry) => entry.projectId === project.id,
    );
    const projectPages = (manifestEntry?.pages ?? []).map((page) => ({
      slug: page.slug,
      title: page.title,
    }));
    const readPage = (slug: string): string | null => {
      const file = resolve(DOCS_OUTPUT_DIR, 'docs', project.id, `${slug}.md`);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    };
    write(`projects/${project.id}/llms.txt`, renderProjectLlms(project, projectPages));
    write(
      `projects/${project.id}/llms-full.txt`,
      renderProjectLlmsFull(project, projectPages, readPage),
    );
  }

  const stateFile = resolve('.cache', 'discovery', 'state.json');
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, serializeJson(buildDeploymentState(resources, generatedAt)), 'utf8');

  logger.info(
    `Discovery: ${resources.length} resources — ${partition.pages.length} pages, ` +
      `${partition.projects.length} project/documentation, ${partition.llms.length} llms.`,
  );

  return { resources, partition };
}

/** Whether a string is a valid IndexNow key (protocol: 8-128 chars of [A-Za-z0-9-]). */
export function isValidIndexNowKey(key: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/.test(key);
}

export interface IndexNowKeyResult {
  ok: boolean;
  /** Written file path, when a file was written. */
  file?: string;
  message: string;
}

/**
 * Write the IndexNow key verification file (`/<key>.txt`) into the built site.
 *
 * The key is a CI secret and is deliberately **not** part of the build: the
 * build never sees it. The deploy workflow runs `bun run discovery:key` after
 * the build, supplying `INDEXNOW_KEY` from the repository secret, and this
 * writes the file IndexNow fetches to prove ownership of the domain.
 */
export function writeIndexNowKeyFile(dist: string, rawKey: string | undefined): IndexNowKeyResult {
  const key = rawKey?.trim();
  if (!key) {
    return { ok: false, message: 'INDEXNOW_KEY is not set; no key verification file was written.' };
  }
  if (!isValidIndexNowKey(key)) {
    return {
      ok: false,
      message:
        'INDEXNOW_KEY is not a valid IndexNow key (expected 8-128 characters of [A-Za-z0-9-]).',
    };
  }
  if (!existsSync(dist)) {
    return { ok: false, message: `Build output directory does not exist: ${dist}` };
  }
  const file = join(dist, `${key}.txt`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, 'utf8');
  return { ok: true, file, message: 'Wrote the IndexNow key verification file.' };
}
