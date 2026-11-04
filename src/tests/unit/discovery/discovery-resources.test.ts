import type { DiscoveryContext } from '../../../src/lib/discovery/resources';
import type { ReleaseCacheData } from '../../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';

import {
  buildResources,
  classifyPath,
  normalizePagePath,
  partitionResources,
} from '../../../src/lib/discovery/resources';
import { DOCS_MANIFEST_SCHEMA } from '../../../src/lib/docs/aggregate';
import { loadProjects } from '../../../src/lib/manifest/load';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../../../src/lib/releases/types';

const emptyReleaseData: ReleaseCacheData = {
  schema: RELEASE_CACHE_SCHEMA_VERSION,
  retrievedAt: '2026-01-01T00:00:00.000Z',
  repos: {},
  releases: {},
  packages: {},
  packageSearch: {},
  npmPackages: {},
};

const context: DiscoveryContext = {
  projects: loadProjects(),
  docsManifest: {
    schema: DOCS_MANIFEST_SCHEMA,
    syncedAt: '2026-01-01T00:00:00.000Z',
    releaseRetrievedAt: '2026-01-01T00:00:00.000Z',
    projects: [
      {
        projectId: 'zodsharp',
        channels: [
          {
            id: 'live',
            ref: 'v2.4.2',
            refKind: 'tag',
            version: '2.4.2',
            label: '2.4.2',
            default: true,
            pages: [
              {
                slug: 'index',
                title: 'ZodSharp',
                order: -1,
                sourcePath: 'docs/wiki/Getting-Started.md',
                hash: 'live-index',
              },
              {
                slug: 'core-concepts',
                title: 'Core concepts',
                order: 1,
                sourcePath: 'docs/wiki/Core-Concepts.md',
                hash: 'live-core',
              },
            ],
          },
          {
            id: 'prerelease',
            ref: 'main',
            refKind: 'branch',
            version: null,
            label: 'main',
            default: false,
            pages: [
              {
                slug: 'index',
                title: 'ZodSharp',
                order: -1,
                sourcePath: 'docs/wiki/Getting-Started.md',
                hash: 'next-index',
              },
            ],
          },
        ],
      },
    ],
  },
  releaseData: emptyReleaseData,
  dataSource: 'fixture',
  fileDates: new Map([['src/src/pages/about.astro', '2025-11-01T00:00:00Z']]),
  fallbackDate: '2025-01-01T00:00:00Z',
  docsLastReviewed: new Map([
    ['zodsharp/core-concepts', '2025-12-02'],
    ['zodsharp/prerelease/index', '2025-12-09'],
  ]),
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
    // Every published version has its own bundle, so the prerelease channel is
    // discoverable without being merged into the live corpus.
    expect(urls).toContain('https://purview.dev/projects/zodsharp/prerelease/llms.txt');
    expect(urls).toContain('https://purview.dev/projects/zodsharp/prerelease/llms-full.txt');
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
    // A version's bundle inherits that version's landing-page review date.
    const prereleaseLlms = resources.find(
      (resource) => resource.url === 'https://purview.dev/projects/zodsharp/prerelease/llms.txt',
    );
    expect(prereleaseLlms?.lastModified).toBe('2025-12-09');
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
