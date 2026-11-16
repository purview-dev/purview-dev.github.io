import type { DocsManifest } from '../../src/lib/docs/aggregate';
import type { ResolvedProject } from '../../src/lib/manifest/load';
import type { ReleaseCacheData } from '../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';

import { DOCS_MANIFEST_SCHEMA } from '../../src/lib/docs/aggregate';
import {
  buildHubs,
  canonicalTopic,
  docsPageUrl,
  topicHubHrefs,
  topicHubPath,
} from '../../src/lib/hubs';

/**
 * Hubs are derived, so the interesting behaviour is the *rules*: which tags earn
 * a page, what a hub lists, and that the ordering is stable.
 */

function project(id: string, overrides: Partial<ResolvedProject> = {}): ResolvedProject {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    shortDescription: `${id} does a thing.`,
    category: 'source-generation',
    status: 'stable',
    experimental: false,
    order: 10,
    repository: `purview-dev/${id}`,
    packages: [],
    related: [],
    useCases: [],
    skills: [],
    assets: [],
    acknowledgments: [],
    ...overrides,
  } as unknown as ResolvedProject;
}

function releaseData(topics: Record<string, string[]>): ReleaseCacheData {
  return {
    repos: Object.fromEntries(
      Object.entries(topics).map(([repository, values]) => [repository, { topics: values }]),
    ),
  } as unknown as ReleaseCacheData;
}

function docsManifest(pages: Record<string, { slug: string; title: string }[]>): DocsManifest {
  return {
    schema: DOCS_MANIFEST_SCHEMA,
    syncedAt: '2026-11-16T00:00:00Z',
    releaseRetrievedAt: '2026-11-16T00:00:00Z',
    projects: Object.entries(pages).map(([projectId, entries]) => ({
      projectId,
      channels: [
        {
          id: 'live' as const,
          ref: 'main',
          refKind: 'branch' as const,
          version: null,
          label: 'main',
          default: true,
          pages: entries.map((entry, index) => ({
            slug: entry.slug,
            title: entry.title,
            order: index,
            sourcePath: `${entry.slug}.md`,
            hash: `${entry.slug}-hash`,
          })),
        },
      ],
    })),
  };
}

const projects = [
  project('unions', { order: 20, category: 'source-generation' }),
  project('zodsharp', { order: 10, category: 'validation' }),
  project('solo', { order: 30, category: 'validation' }),
];

const data = releaseData({
  'purview-dev/unions': ['csharp', 'union-types', 'value-types'],
  'purview-dev/zodsharp': ['csharp', 'validation'],
  'purview-dev/solo': ['lonely-topic'],
});

const manifest = docsManifest({
  unions: [
    { slug: 'index', title: 'Unions' },
    { slug: 'union-design', title: 'Union design' },
  ],
  zodsharp: [{ slug: 'index', title: 'ZodSharp' }],
});

describe('buildHubs', () => {
  const hubs = buildHubs(projects, data, manifest);

  test('publishes a hub only for a topic shared by enough projects', () => {
    const slugs = hubs.topics.map((hub) => hub.slug).toSorted();
    // `union-types` and `validation` are each on one project only, so neither
    // earns a page; `csharp` is shared and does. `lonely-topic` is not shared.
    expect(slugs).toEqual(['csharp']);
    expect(slugs).not.toContain('union-types');
    expect(slugs).not.toContain('lonely-topic');
  });

  test('lists the projects the topic is on, in catalogue order', () => {
    const csharp = hubs.topics.find((hub) => hub.slug === 'csharp');
    expect(csharp?.projects.map((entry) => entry.id)).toEqual(['zodsharp', 'unions']);
  });

  test('lists documentation pages of the tagged projects, without the landing page', () => {
    const csharp = hubs.topics.find((hub) => hub.slug === 'csharp');
    expect(csharp?.pages.map((page) => page.url)).toEqual(['/docs/unions/union-design/']);
  });

  test('labels a topic with the words a reader types', () => {
    const csharp = hubs.topics.find((hub) => hub.slug === 'csharp');
    expect(csharp?.label).toBe('C#');
    expect(csharp?.path).toBe('/topics/csharp/');
    expect(csharp?.title).toContain('C#');
  });

  test('orders topics by how many projects they index', () => {
    expect(hubs.topics[0]?.slug).toBe('csharp');
  });

  test('builds a category hub from the same projects', () => {
    // `source-generation` holds one project, so it is not published either.
    const categories = hubs.categories.map((hub) => hub.slug).toSorted();
    expect(categories).toEqual(['validation']);
  });

  test('omits archived projects entirely', () => {
    const allTopics = releaseData({
      'purview-dev/unions': ['csharp', 'union-types', 'value-types'],
      'purview-dev/zodsharp': ['csharp', 'validation'],
      'purview-dev/solo': ['lonely-topic'],
      'purview-dev/dead': ['csharp'],
    });
    const withArchived = buildHubs(
      [...projects, project('dead', { status: 'archived', repository: 'purview-dev/dead' })],
      allTopics,
      manifest,
    );
    const csharp = withArchived.topics.find((hub) => hub.slug === 'csharp');
    expect(csharp?.projects.map((entry) => entry.id)).not.toContain('dead');
  });

  test('reports the topic spellings that have a hub, mapped to their href', () => {
    const hrefs = topicHubHrefs(hubs);
    expect(hrefs.get('csharp')).toBe('/topics/csharp/');
    // A repository that spells the topic `c-sharp` links the canonical hub.
    expect(hrefs.get('c-sharp')).toBe('/topics/csharp/');
    expect(hrefs.has('lonely-topic')).toBe(false);
  });

  test('groups two spellings of one topic into a single hub', () => {
    const spelledTwoWays = buildHubs(
      projects,
      releaseData({
        'purview-dev/unions': ['c-sharp'],
        'purview-dev/zodsharp': ['csharp'],
      }),
      manifest,
    );
    const hub = spelledTwoWays.topics.find((candidate) => candidate.slug === 'csharp');
    expect(hub?.projects.map((entry) => entry.id)).toEqual(['zodsharp', 'unions']);
    expect(spelledTwoWays.topics.filter((candidate) => candidate.label === 'C#')).toHaveLength(1);
  });

  test('no two hubs share a title', () => {
    const titles = [...hubs.topics, ...hubs.categories].map((hub) => hub.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('topic paths are lowercase slugs', () => {
    expect(topicHubPath('c-sharp')).toBe('/topics/c-sharp/');
  });

  test('canonicalises the spellings of one topic', () => {
    expect(canonicalTopic('c-sharp')).toBe('csharp');
    expect(canonicalTopic('CSharp')).toBe('csharp');
    // A distinct topic is left alone.
    expect(canonicalTopic('net10')).toBe('net10');
  });

  test('an index page addresses its folder, at any depth', () => {
    expect(docsPageUrl('unions', 'index')).toBe('/docs/unions/');
    expect(docsPageUrl('astroc4', 'guide/index')).toBe('/docs/astroc4/guide/');
    expect(docsPageUrl('unions', 'union-design')).toBe('/docs/unions/union-design/');
    expect(docsPageUrl('zodsharp', 'schemas/custom-rules')).toBe(
      '/docs/zodsharp/schemas/custom-rules/',
    );
  });
});
