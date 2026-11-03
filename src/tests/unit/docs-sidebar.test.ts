import type { DocsManifest, DocsManifestChannel } from '../../src/lib/docs/aggregate';
import type { DocChannelId } from '../../src/lib/docs/channels';
import type {
  SidebarDocItem,
  SidebarGroupEntry,
  SidebarSlugEntry,
} from '../../src/lib/docs/sidebar';

import { describe, expect, test } from 'bun:test';

import { DOCS_MANIFEST_SCHEMA } from '../../src/lib/docs/aggregate';
import { buildProjectTopics, docSectionLabel, docSectionTrail } from '../../src/lib/docs/sidebar';
import { loadProjects } from '../../src/lib/manifest/load';

const project = loadProjects().find((candidate) => candidate.id === 'zodsharp');
if (!project) {
  throw new Error('the catalogue must define zodsharp for these tests');
}

function page(slug: string, title: string, order: number): DocsManifestChannel['pages'][number] {
  return {
    slug,
    title,
    order,
    sourcePath: `docs/wiki/${slug.replace(/\//g, '-')}.md`,
    hash: `${slug}-hash`,
  };
}

const flatPages = [page('index', 'ZodSharp', -1), page('core-concepts', 'Core concepts', 1)];

/**
 * The shape ZodSharp's prerelease tree publishes (ADR 0011): pages at the docs
 * root beside folders that carry their own pages, in the order `_Sidebar.md`
 * gives, which is the order the sync keeps.
 */
const nestedPages = [
  page('index', 'ZodSharp', -1),
  page('getting-started', 'Getting Started', 1),
  page('concepts/core-concepts', 'Core Concepts', 2),
  page('fluent-schema-api', 'Fluent Schema API', 3),
  page('schemas/string-validation', 'String Validation', 4),
  page('concepts/composition-and-transforms', 'Composition and Transforms', 5),
  page('schemas/custom-rules', 'Custom Rules', 6),
  page('development/contributing', 'Contributing', 7),
];

function channel(
  id: DocChannelId,
  overrides: Partial<DocsManifestChannel> = {},
): DocsManifestChannel {
  const live = id === 'live';
  return {
    id,
    ref: live ? 'v2.4.2' : 'main',
    refKind: live ? 'tag' : 'branch',
    version: live ? '2.4.2' : '3.0.0-prerelease.2',
    label: live ? '2.4.2' : '3.0.0-prerelease.2',
    default: live,
    pages: flatPages,
    ...overrides,
  };
}

function manifest(channels: DocsManifestChannel[]): DocsManifest {
  return {
    schema: DOCS_MANIFEST_SCHEMA,
    syncedAt: '2026-01-01T00:00:00.000Z',
    releaseRetrievedAt: '2026-01-01T00:00:00.000Z',
    projects: [{ projectId: project!.id, channels }],
  };
}

const bothChannels = () => manifest([channel('live'), channel('prerelease')]);

/** A group is the only sidebar item that carries children. */
function isGroup(item: SidebarDocItem): item is SidebarGroupEntry {
  return 'items' in item;
}

/** Every page link in an item list, depth-first, so tests can assert on the pages. */
function leaves(items: SidebarDocItem[]): SidebarSlugEntry[] {
  return items.flatMap((item) => (isGroup(item) ? leaves(item.items) : [item]));
}

describe('documentation sidebar topics', () => {
  test('a single-channel project keeps one flat topic named after the project', () => {
    const topics = buildProjectTopics(project!, manifest([channel('live')]));
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ label: 'ZodSharp', link: '/docs/zodsharp/' });
    expect(topics[0]!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp' },
      { label: 'Core concepts', slug: 'docs/zodsharp/core-concepts' },
    ]);
  });

  test('a versioned project still reads as one project in the sidebar', () => {
    const topics = buildProjectTopics(project!, bothChannels());
    // One topic per version internally (each with that version's pages), but
    // every topic carries the project name: versions never leak into the
    // sidebar — the page switcher is where a reader chooses one.
    expect(topics.map((topic) => topic.label)).toEqual(['ZodSharp', 'ZodSharp']);
    expect(topics.map((topic) => topic.link)).toEqual([
      '/docs/zodsharp/',
      '/docs/zodsharp/prerelease/',
    ]);
    expect(topics.map((topic) => topic.id)).toEqual(['zodsharp-live', 'zodsharp-prerelease']);
  });

  test('the sidebar never names a version', () => {
    for (const topic of buildProjectTopics(project!, bothChannels())) {
      expect(topic.label).not.toContain('2.4.2');
      expect(topic.label).not.toContain('3.0.0');
    }
  });

  test('the two versions never share a page or a group', () => {
    const [live, prerelease] = buildProjectTopics(project!, bothChannels());
    const liveSlugs = new Set(leaves(live!.items).map((item) => item.slug));
    expect(leaves(prerelease!.items).some((item) => liveSlugs.has(item.slug))).toBe(false);
    expect(prerelease!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp/prerelease' },
      { label: 'Core concepts', slug: 'docs/zodsharp/prerelease/core-concepts' },
    ]);
  });

  test('a flat corpus stays a flat list of links', () => {
    // A project that never nests a page renders exactly what it did before
    // folders existed: no group, one link per page, in the channel's order.
    for (const topic of buildProjectTopics(project!, bothChannels())) {
      expect(topic.items.every((item) => !isGroup(item))).toBe(true);
      for (const item of topic.items) {
        expect(Object.keys(item).toSorted()).toEqual(['label', 'slug']);
      }
    }
  });

  test('a page folder is a group that mirrors the published path', () => {
    const topics = buildProjectTopics(
      project!,
      manifest([channel('prerelease', { pages: nestedPages })]),
    );
    expect(topics[0]!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp/prerelease' },
      { label: 'Getting Started', slug: 'docs/zodsharp/prerelease/getting-started' },
      {
        label: 'Concepts',
        items: [
          { label: 'Core Concepts', slug: 'docs/zodsharp/prerelease/concepts/core-concepts' },
          {
            label: 'Composition and Transforms',
            slug: 'docs/zodsharp/prerelease/concepts/composition-and-transforms',
          },
        ],
      },
      { label: 'Fluent Schema API', slug: 'docs/zodsharp/prerelease/fluent-schema-api' },
      {
        label: 'Schemas',
        items: [
          {
            label: 'String Validation',
            slug: 'docs/zodsharp/prerelease/schemas/string-validation',
          },
          { label: 'Custom Rules', slug: 'docs/zodsharp/prerelease/schemas/custom-rules' },
        ],
      },
      {
        label: 'Development',
        items: [
          { label: 'Contributing', slug: 'docs/zodsharp/prerelease/development/contributing' },
        ],
      },
    ]);
  });

  test('a group sits where its first page sits and holds its whole folder', () => {
    // `concepts` is entered by Core Concepts (third entry) and continued by
    // Composition and Transforms (sixth): the group keeps the first position and
    // absorbs the later page, so a folder is listed once and its pages keep the
    // order the channel gave them.
    const [topic] = buildProjectTopics(
      project!,
      manifest([channel('prerelease', { pages: nestedPages })]),
    );
    expect(topic!.items.map((item) => item.label)).toEqual([
      'Overview',
      'Getting Started',
      'Concepts',
      'Fluent Schema API',
      'Schemas',
      'Development',
    ]);
    const concepts = topic!.items.find(
      (item): item is SidebarGroupEntry => isGroup(item) && item.label === 'Concepts',
    );
    expect(concepts!.items.map((item) => item.label)).toEqual([
      'Core Concepts',
      'Composition and Transforms',
    ]);
  });

  test('folders nest as deeply as the tree does', () => {
    const topics = buildProjectTopics(
      project!,
      manifest([
        channel('live', {
          pages: [
            page('index', 'ZodSharp', -1),
            page('guides/getting-started/install', 'Install', 1),
            page('guides/getting-started/upgrade', 'Upgrade', 2),
          ],
        }),
      ]),
    );
    expect(topics[0]!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp' },
      {
        label: 'Guides',
        items: [
          {
            label: 'Getting Started',
            items: [
              { label: 'Install', slug: 'docs/zodsharp/guides/getting-started/install' },
              { label: 'Upgrade', slug: 'docs/zodsharp/guides/getting-started/upgrade' },
            ],
          },
        ],
      },
    ]);
  });

  test('a folder index page links the folder, not a page called index', () => {
    // Starlight serves `<base>/schemas/` for `schemas/index.md`, so a nested
    // index is published at the folder's own address and must be linked there.
    const topics = buildProjectTopics(
      project!,
      manifest([
        channel('live', {
          pages: [
            page('index', 'ZodSharp', -1),
            page('schemas/index', 'Schemas', 1),
            page('schemas/custom-rules', 'Custom Rules', 2),
          ],
        }),
      ]),
    );
    expect(topics[0]!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp' },
      {
        label: 'Schemas',
        items: [
          { label: 'Schemas', slug: 'docs/zodsharp/schemas' },
          { label: 'Custom Rules', slug: 'docs/zodsharp/schemas/custom-rules' },
        ],
      },
    ]);
  });

  test('no docs manifest means no topics', () => {
    expect(buildProjectTopics(project!, null)).toEqual([]);
  });
});

describe('documentation sections', () => {
  test('a folder segment is spelled out as a label', () => {
    expect(docSectionLabel('schemas')).toBe('Schemas');
    expect(docSectionLabel('compiled-validators')).toBe('Compiled Validators');
    expect(docSectionLabel('getting_started')).toBe('Getting Started');
    // A segment that is an initialism keeps its capitalisation.
    expect(docSectionLabel('json')).toBe('JSON');
    expect(docSectionLabel('json-schema')).toBe('JSON Schema');
  });

  test('a page reports the folders above it', () => {
    expect(docSectionTrail('schemas/custom-rules')).toEqual(['Schemas']);
    expect(docSectionTrail('guides/getting-started/install')).toEqual([
      'Guides',
      'Getting Started',
    ]);
    expect(docSectionTrail('schemas/index')).toEqual(['Schemas']);
    // A page at the docs root has no section above it.
    expect(docSectionTrail('core-concepts')).toEqual([]);
    expect(docSectionTrail('index')).toEqual([]);
  });
});
