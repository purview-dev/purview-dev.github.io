import type { DocsManifest } from '../docs/aggregate';
import type { ResolvedProject } from '../manifest/load';
import type { DataSource } from '../releases/transform';
import type { ReleaseCacheData } from '../releases/types';
import type { DiscoverableKind, DiscoverableResource } from './types';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_OUTPUT_DIR, readDocsManifest } from '../docs/aggregate';
import { loadProjects } from '../manifest/load';
import { getReleaseIndex } from '../releases/runtime';
import {
  firstTimestamp,
  latestTimestamp,
  readGitFileDates,
  type FileDateIndex,
} from './last-modified';
import {
  canonical,
  projectLlmsFullUrl,
  projectLlmsUrl,
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
 * or trailing slash).
 */
export const PAGE_SOURCES: Readonly<Record<string, string>> = {
  '': 'src/src/pages/index.astro',
  about: 'src/src/pages/about.astro',
  docs: 'src/src/pages/docs/index.astro',
  projects: 'src/src/pages/projects/index.astro',
  releases: 'src/src/pages/releases/index.astro',
  'use-cases': 'src/src/pages/use-cases/index.astro',
};

/** Repo-relative catalogue file for a project id. */
export function projectManifestFile(id: string): string {
  return `src/src/data/projects/${id}.yml`;
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
 */
export function readDocsLastReviewed(mirrorRoot = DOCS_OUTPUT_DIR): Map<string, string> {
  const result = new Map<string, string>();
  const docsRoot = join(mirrorRoot, 'docs');
  if (!existsSync(docsRoot)) {
    return result;
  }
  for (const projectId of readdirSync(docsRoot)) {
    const projectDir = join(docsRoot, projectId);
    let files: string[];
    try {
      files = readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.md')) {
        continue;
      }
      const content = readFileSync(join(projectDir, file), 'utf8');
      const match = LAST_REVIEWED.exec(content);
      if (match?.[1]) {
        result.set(`${projectId}/${file.replace(/\.md$/, '')}`, match[1]);
      }
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
  return preferTimestamp(
    [
      ctx.fileDates.get(projectManifestFile(id)),
      latestReleaseDate(ctx.releaseData, project?.repository),
    ],
    ctx.fallbackDate,
  );
}

/** `lastmod` for an aggregated documentation page: the review date wins. */
export function documentationLastModified(
  projectId: string,
  slug: string,
  ctx: DiscoveryContext,
): string | undefined {
  return firstTimestamp([
    ctx.docsLastReviewed.get(`${projectId}/${slug}`),
    ctx.fileDates.get(projectManifestFile(projectId)),
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
        ctx.fileDates.get(PAGE_SOURCES[normalized] ?? ''),
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
    const lastModified = documentationLastModified(project.id, 'index', ctx) ?? docsSyncedAt;
    list.push({
      url: projectLlmsUrl(project.id),
      kind: 'llms',
      lastModified,
      indexable: true,
      projectId: project.id,
    });
    list.push({
      url: projectLlmsFullUrl(project.id),
      kind: 'llms-full',
      lastModified,
      indexable: true,
      projectId: project.id,
    });
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
