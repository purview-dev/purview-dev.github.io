import type { DocsManifest } from '../docs/aggregate';
import type { ResolvedProject } from '../manifest/load';
import type { DataSource } from '../releases/transform';
import type { ReleaseCacheData } from '../releases/types';
import type { DiscoverableKind, DiscoverableResource } from './types';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { DOCS_OUTPUT_DIR, readDocsManifest } from '../docs/aggregate';
import { loadProjects } from '../manifest/load';
import { getReleaseIndex } from '../releases/runtime';
import { findWorkspaceRoot } from '../site-version';
import {
  firstTimestamp,
  latestTimestamp,
  readGitFileDates,
  type FileDateIndex,
} from './last-modified';
import {
  canonical,
  projectChannelLlmsFullUrl,
  projectChannelLlmsUrl,
  rootLlmsFullUrl,
  rootLlmsSmallUrl,
  rootLlmsUrl,
} from './urls';

/**
 * Building the `DiscoverableResource[]` from the site's existing sources of
 * truth: the project catalogue (`loadProjects`), the aggregated documentation
 * manifest (`readDocsManifest`) and the release cache (`getReleaseIndex`). No
 * hand-maintained URL list exists anywhere.
 */

/**
 * Repo-relative source file for each hand-authored page, so its `lastmod` can be
 * the commit that last touched it. Keys are normalised route paths (no leading
 * or trailing slash); dynamic routes are keyed by a `null` segment.
 *
 * The index is built by walking `src/pages` rather than being a hand-kept map: a
 * page that is not in the map silently falls back to the release cache's
 * retrieval time, which is the build time, which is exactly the signal a sitemap
 * must never send. Deriving it means a new page (or a new page family) is dated
 * correctly the moment it exists.
 */
const PAGES_DIR = 'src/src/pages';

interface PageSourceIndex {
  exact: Map<string, string>;
  patterns: { segments: readonly (string | null)[]; file: string }[];
}

function buildPageSourceIndex(pagesDir = PAGES_DIR): PageSourceIndex {
  const index: PageSourceIndex = { exact: new Map(), patterns: [] };
  // Git paths are workspace-relative, and the scripts run from the `src/`
  // package, so the walk has to start at the workspace root to produce keys that
  // match `git log --name-only`.
  let root: string;
  try {
    root = findWorkspaceRoot();
  } catch {
    return index;
  }
  const walk = (directory: string, prefix: readonly string[]): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), [...prefix, entry.name]);
        continue;
      }
      const extension = /\.(astro|md|mdx)$/.exec(entry.name);
      if (!extension) {
        continue;
      }
      const base = entry.name.slice(0, -extension[0].length);
      const segments = base === 'index' ? [...prefix] : [...prefix, base];
      const file = relative(root, join(directory, entry.name)).replace(/\\/g, '/');
      // `[topic]` addresses any value, so the route it produces cannot be a key.
      const patterned = segments.map((segment) => (/^\[.+\]$/.test(segment) ? null : segment));
      if (patterned.some((segment) => segment === null)) {
        index.patterns.push({ segments: patterned, file });
      } else {
        index.exact.set(segments.join('/'), file);
      }
    }
  };
  walk(resolve(root, pagesDir), []);
  return index;
}

let pageSourceIndexCache: PageSourceIndex | undefined;

/** The source file that renders a normalised route, or undefined. */
export function pageSourceFor(route: string): string | undefined {
  const index = (pageSourceIndexCache ??= buildPageSourceIndex());
  const direct = index.exact.get(route);
  if (direct !== undefined) {
    return direct;
  }
  const segments = route === '' ? [] : route.split('/');
  for (const pattern of index.patterns) {
    if (pattern.segments.length !== segments.length) {
      continue;
    }
    if (
      pattern.segments.every(
        (segment, position) => segment === null || segment === segments[position],
      )
    ) {
      return pattern.file;
    }
  }
  return undefined;
}

/**
 * Repo-relative catalogue file for a project id, or `null` when the project owns
 * its record in its own repository (ADR 0013). This repository then has no commit
 * to date the record from, so the caller falls back to the release date.
 */
export function projectManifestFile(id: string): string | null {
  const file = `src/src/data/projects/${id}.yml`;
  return existsSync(resolve(file)) ? file : null;
}

export interface DiscoveryContext {
  projects: ResolvedProject[];
  docsManifest: DocsManifest | null;
  releaseData: ReleaseCacheData;
  /** Which source the release data came from (live/cache/fixture). */
  dataSource: DataSource;
  /** Path -> last commit date; empty when Git is unavailable. */
  fileDates: FileDateIndex;
  /** Coarse fallback date (release cache retrieval time). */
  fallbackDate: string | null;
  /** `"<projectId>/<slug>"` -> the documentation page's own `lastReviewed` date. */
  docsLastReviewed: Map<string, string>;
}

const LAST_REVIEWED = /^lastReviewed:\s*"?(\d{4}-\d{2}-\d{2})"?/m;

/**
 * Read each aggregated page's `lastReviewed` date from the generated docs
 * mirror's front matter. The mirror is present whenever the site builds, so this
 * gives documentation pages a real `lastmod` without changing the docs manifest
 * schema (which would force a full re-sync of the gitignored mirror).
 *
 * Keys are `"<projectId>/<slug>"` for the default channel and
 * `"<projectId>/<channel>/<slug>"` for an alternative one, matching the URL
 * path segment `classifyPath` derives for a built page.
 */
export function readDocsLastReviewed(mirrorRoot = DOCS_OUTPUT_DIR): Map<string, string> {
  const result = new Map<string, string>();
  const docsRoot = join(mirrorRoot, 'docs');
  if (!existsSync(docsRoot)) {
    return result;
  }

  const collect = (directory: string, keyPrefix: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // A channel directory: docs/<id>/<channel>/<slug>.md
        collect(join(directory, entry.name), `${keyPrefix}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith('.md')) {
        continue;
      }
      const match = LAST_REVIEWED.exec(readFileSync(join(directory, entry.name), 'utf8'));
      if (match?.[1]) {
        result.set(`${keyPrefix}/${entry.name.replace(/\.md$/, '')}`, match[1]);
      }
    }
  };

  for (const entry of readdirSync(docsRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collect(join(docsRoot, entry.name), entry.name);
    }
  }
  return result;
}

/** Build a discovery context from the real catalogue, docs manifest and cache. */
export function loadDiscoveryContext(): DiscoveryContext {
  const docsManifest = readDocsManifest();
  const releaseIndex = getReleaseIndex();
  return {
    projects: loadProjects(),
    docsManifest,
    releaseData: releaseIndex.data,
    dataSource: releaseIndex.source,
    fileDates: readGitFileDates() ?? new Map(),
    fallbackDate: releaseIndex.data.retrievedAt || null,
    docsLastReviewed: readDocsLastReviewed(),
  };
}

/** Remove a leading/trailing slash and any base prefix from an Astro pathname. */
export function normalizePagePath(pathname: string, base = '/'): string {
  let path = pathname.trim();
  if (base && base !== '/') {
    const prefix = base.replace(/\/+$/, '');
    if (path === prefix) {
      path = '';
    } else if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length);
    }
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  path = path.replace(/\/?index\.html$/, '');
  return path;
}

/** Classify a normalised route path into a resource kind. */
export function classifyPath(
  normalized: string,
  projectIds: ReadonlySet<string>,
): { kind: DiscoverableKind; projectId?: string; docsSlug?: string } {
  if (normalized === '') {
    return { kind: 'page' };
  }
  const parts = normalized.split('/').filter(Boolean);
  const head = parts[0];
  if (head === 'projects' && parts.length === 2 && projectIds.has(parts[1] ?? '')) {
    return { kind: 'project', projectId: parts[1] };
  }
  if (head === 'docs' && parts.length >= 2 && projectIds.has(parts[1] ?? '')) {
    const slug = parts.slice(2).join('/') || 'index';
    return { kind: 'documentation', projectId: parts[1], docsSlug: slug };
  }
  return { kind: 'page' };
}

/** The most recent of a set of timestamps. */
function preferTimestamp(
  primary: readonly (string | null | undefined)[],
  fallback: string | null,
): string | undefined {
  return latestTimestamp(primary) ?? latestTimestamp([fallback]);
}

/** Latest GitHub release date for a repository, when the cache knows it. */
function latestReleaseDate(data: ReleaseCacheData, repository: string | undefined): string | null {
  if (!repository) {
    return null;
  }
  return (
    latestTimestamp((data.releases[repository] ?? []).map((release) => release.publishedAt)) ?? null
  );
}

/** `lastmod` for a project's HTML page: manifest commit or latest release. */
export function projectLastModified(id: string, ctx: DiscoveryContext): string | undefined {
  const project = ctx.projects.find((candidate) => candidate.id === id);
  const manifestFile = projectManifestFile(id);
  return preferTimestamp(
    [
      manifestFile === null ? undefined : ctx.fileDates.get(manifestFile),
      latestReleaseDate(ctx.releaseData, project?.repository),
    ],
    ctx.fallbackDate,
  );
}

/**
 * `lastmod` for an aggregated documentation page: the review date wins.
 *
 * `channelId` addresses a non-default version, whose mirror key carries the
 * channel segment (`<project>/<channel>/<slug>`) exactly like its URL does.
 */
export function documentationLastModified(
  projectId: string,
  slug: string,
  ctx: DiscoveryContext,
  channelId?: string,
): string | undefined {
  const key = channelId ? `${projectId}/${channelId}/${slug}` : `${projectId}/${slug}`;
  const manifestFile = projectManifestFile(projectId);
  return firstTimestamp([
    ctx.docsLastReviewed.get(key),
    manifestFile === null ? undefined : ctx.fileDates.get(manifestFile),
    ctx.fallbackDate,
  ]);
}

/** `lastmod` for the machine-readable bundles, which follow the docs sync. */
function llmsLastModified(ctx: DiscoveryContext): string | undefined {
  return firstTimestamp([ctx.docsManifest?.syncedAt, ctx.fallbackDate]);
}

/** Projects with aggregated documentation and a non-archived lifecycle. */
export function documentedProjects(ctx: DiscoveryContext): ResolvedProject[] {
  return ctx.projects.filter((project) => project.docs && project.status !== 'archived');
}

/** De-duplicate by URL, keeping the first occurrence, sorted by URL. */
export function dedupeByUrl(resources: readonly DiscoverableResource[]): DiscoverableResource[] {
  const byUrl = new Map<string, DiscoverableResource>();
  for (const resource of resources) {
    if (!byUrl.has(resource.url)) {
      byUrl.set(resource.url, resource);
    }
  }
  return [...byUrl.values()].toSorted((a, b) => a.url.localeCompare(b.url));
}

/**
 * Derive every discoverable resource from the page list Astro built plus the
 * catalogue and docs/release metadata. Deterministic and de-duplicated by URL.
 */
export function buildResources(
  pagePaths: readonly string[],
  ctx: DiscoveryContext,
): DiscoverableResource[] {
  const projectIds = new Set(ctx.projects.map((project) => project.id));
  const list: DiscoverableResource[] = [];

  for (const raw of pagePaths) {
    const normalized = normalizePagePath(raw);
    if (normalized === '404' || normalized === '500') {
      continue;
    }
    // Non-HTML endpoints (`/skills.json`, …) are machine-readable resources, not
    // pages: they are linked from the pages that describe them and stay out of
    // the HTML sitemap, like `discover.json`.
    if (
      normalized.endsWith('.json') ||
      normalized.endsWith('.xml') ||
      normalized.endsWith('.txt')
    ) {
      continue;
    }
    const classified = classifyPath(normalized, projectIds);
    let lastModified: string | undefined;
    if (classified.kind === 'project' && classified.projectId) {
      lastModified = projectLastModified(classified.projectId, ctx);
    } else if (classified.kind === 'documentation' && classified.projectId) {
      lastModified = documentationLastModified(
        classified.projectId,
        classified.docsSlug ?? 'index',
        ctx,
      );
    } else {
      lastModified = firstTimestamp([
        ctx.fileDates.get(pageSourceFor(normalized) ?? ''),
        ctx.fallbackDate,
      ]);
    }

    list.push({
      url: canonical(normalized === '' ? '/' : `/${normalized}/`),
      kind: classified.kind,
      lastModified,
      indexable: true,
      ...(classified.projectId ? { projectId: classified.projectId } : {}),
    });
  }

  const docsSyncedAt = llmsLastModified(ctx);
  list.push({ url: rootLlmsUrl(), kind: 'llms', lastModified: docsSyncedAt, indexable: true });
  list.push({
    url: rootLlmsSmallUrl(),
    kind: 'llms-small',
    lastModified: docsSyncedAt,
    indexable: true,
  });
  list.push({
    url: rootLlmsFullUrl(),
    kind: 'llms-full',
    lastModified: docsSyncedAt,
    indexable: true,
  });

  for (const project of documentedProjects(ctx)) {
    const entry = ctx.docsManifest?.projects.find(
      (candidate) => candidate.projectId === project.id,
    );
    const channels = entry?.channels ?? [];
    // One bundle pair per published version (ADR 0009). The default channel
    // keeps `/projects/<id>/llms*.txt`; every other version adds its channel
    // segment, mirroring its documentation URLs.
    const targets: (typeof channels)[number][] | [undefined] =
      channels.length > 0 ? channels : [undefined];
    for (const channel of targets) {
      const channelId = channel?.id ?? 'live';
      const isDefault = channel?.default ?? true;
      const lastModified =
        documentationLastModified(project.id, 'index', ctx, isDefault ? undefined : channelId) ??
        docsSyncedAt;
      list.push({
        url: projectChannelLlmsUrl(project.id, channelId, isDefault),
        kind: 'llms',
        lastModified,
        indexable: true,
        projectId: project.id,
      });
      list.push({
        url: projectChannelLlmsFullUrl(project.id, channelId, isDefault),
        kind: 'llms-full',
        lastModified,
        indexable: true,
        projectId: project.id,
      });
    }
  }

  return dedupeByUrl(list);
}

export interface SitemapPartition {
  pages: DiscoverableResource[];
  projects: DiscoverableResource[];
  llms: DiscoverableResource[];
}

/** Split indexable resources into the three logical sitemaps. */
export function partitionResources(resources: readonly DiscoverableResource[]): SitemapPartition {
  const indexable = resources.filter((resource) => resource.indexable);
  return {
    pages: indexable.filter((resource) => resource.kind === 'page' || resource.kind === 'other'),
    projects: indexable.filter(
      (resource) => resource.kind === 'project' || resource.kind === 'documentation',
    ),
    llms: indexable.filter(
      (resource) =>
        resource.kind === 'llms' || resource.kind === 'llms-full' || resource.kind === 'llms-small',
    ),
  };
}
