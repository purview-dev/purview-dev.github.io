import type { DiscoveryContext } from '../../../src/lib/discovery/resources';
import type { ReleaseCacheData } from '../../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';

import {
  buildResources,
  classifyPath,
  normalizePagePath,
  partitionResources,
} from '../../../src/lib/discovery/resources';
import { loadProjects } from '../../../src/lib/manifest/load';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../../../src/lib/releases/types';

const emptyReleaseData: ReleaseCacheData = {
  schema: RELEASE_CACHE_SCHEMA_VERSION,
  retrievedAt: '2026-01-01T00:00:00.000Z',
  repos: {},
  releases: {},
  packages: {},
  packageSearch: {},
};

const context: DiscoveryContext = {
  projects: loadProjects(),
  docsManifest: {
    schema: 1,
    syncedAt: '2026-01-01T00:00:00.000Z',
    projects: [
      {
        projectId: 'zodsharp',
        pages: [
          { slug: 'index', title: 'ZodSharp', order: 0 },
          { slug: 'core-concepts', title: 'Core concepts', order: 1 },
        ],
      },
    ],
  },
  releaseData: emptyReleaseData,
  dataSource: 'fixture',
  fileDates: new Map([['src/src/pages/about.astro', '2025-11-01T00:00:00Z']]),
  fallbackDate: '2025-01-01T00:00:00Z',
  docsLastReviewed: new Map([['zodsharp/core-concepts', '2025-12-02']]),
};

describe('page path normalisation', () => {
  test('normalises Astro pathnames and base prefixes', () => {
    expect(normalizePagePath('')).toBe('');
    expect(normalizePagePath('about/')).toBe('about');
    expect(normalizePagePath('/about/')).toBe('about');
    expect(normalizePagePath('about/index.html')).toBe('about');
    expect(normalizePagePath('index.html')).toBe('');
    expect(normalizePagePath('/purview-dev/about/', '/purview-dev')).toBe('about');
  });

  test('classifies catalogue and documentation routes', () => {
    const ids = new Set(['zodsharp']);
    expect(classifyPath('', ids)).toEqual({ kind: 'page' });
    expect(classifyPath('projects/zodsharp', ids)).toEqual({
      kind: 'project',
      projectId: 'zodsharp',
    });
    expect(classifyPath('docs/zodsharp', ids)).toEqual({
      kind: 'documentation',
      projectId: 'zodsharp',
      docsSlug: 'index',
    });
    expect(classifyPath('docs/zodsharp/core-concepts', ids)).toEqual({
      kind: 'documentation',
      projectId: 'zodsharp',
      docsSlug: 'core-concepts',
    });
    expect(classifyPath('projects/unknown', ids)).toEqual({ kind: 'page' });
  });
});

describe('resource building', () => {
  const resources = buildResources(
    ['', 'about/', 'projects/zodsharp/', 'docs/zodsharp/', 'docs/zodsharp/core-concepts/', '404/'],
    context,
  );
  const urls = resources.map((resource) => resource.url);

  test('classifies pages, projects, documentation and llms', () => {
    expect(urls).toContain('https://purview.dev/');
    expect(urls).toContain('https://purview.dev/about/');
    expect(urls).toContain('https://purview.dev/projects/zodsharp/');
    expect(urls).toContain('https://purview.dev/docs/zodsharp/');
    expect(urls).toContain('https://purview.dev/docs/zodsharp/core-concepts/');
    expect(urls).toContain('https://purview.dev/llms.txt');
    expect(urls).toContain('https://purview.dev/projects/zodsharp/llms.txt');
    expect(urls).toContain('https://purview.dev/projects/zodsharp/llms-full.txt');
  });

  test('excludes error pages and de-duplicates', () => {
    expect(urls.some((url) => url.includes('404'))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test('uses content-derived lastmod values, not the build time', () => {
    const about = resources.find((resource) => resource.url === 'https://purview.dev/about/');
    expect(about?.lastModified).toBe('2025-11-01T00:00:00Z');
    const docs = resources.find(
      (resource) => resource.url === 'https://purview.dev/docs/zodsharp/core-concepts/',
    );
    expect(docs?.lastModified).toBe('2025-12-02');
  });

  test('partitions indexable resources into three sitemaps', () => {
    const partition = partitionResources(resources);
    expect(partition.pages.some((resource) => resource.url === 'https://purview.dev/about/')).toBe(
      true,
    );
    expect(
      partition.projects.some((resource) => resource.url === 'https://purview.dev/docs/zodsharp/'),
    ).toBe(true);
    expect(partition.llms.some((resource) => resource.url === 'https://purview.dev/llms.txt')).toBe(
      true,
    );
  });
});
