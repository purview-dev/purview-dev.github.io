import type { DocsManifest, DocsManifestChannel } from '../../src/lib/docs/aggregate';
import type { DocChannelId } from '../../src/lib/docs/channels';

import { describe, expect, test } from 'bun:test';

import { DOCS_MANIFEST_SCHEMA } from '../../src/lib/docs/aggregate';
import { buildProjectTopics } from '../../src/lib/docs/sidebar';
import { loadProjects } from '../../src/lib/manifest/load';

const project = loadProjects().find((candidate) => candidate.id === 'zodsharp');
if (!project) {
  throw new Error('the catalogue must define zodsharp for these tests');
}

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
    pages: [
      {
        slug: 'index',
        title: 'ZodSharp',
        order: -1,
        sourcePath: 'docs/wiki/Getting-Started.md',
        hash: `${id}-index`,
      },
      {
        slug: 'core-concepts',
        title: 'Core concepts',
        order: 1,
        sourcePath: 'docs/wiki/Core-Concepts.md',
        hash: `${id}-core`,
      },
    ],
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
    const liveSlugs = new Set(live!.items.map((item) => item.slug));
    expect(prerelease!.items.some((item) => liveSlugs.has(item.slug))).toBe(false);
    expect(prerelease!.items).toEqual([
      { label: 'Overview', slug: 'docs/zodsharp/prerelease' },
      { label: 'Core concepts', slug: 'docs/zodsharp/prerelease/core-concepts' },
    ]);
  });

  test('a topic is a flat list of links, never nested groups', () => {
    for (const topic of buildProjectTopics(project!, bothChannels())) {
      for (const item of topic.items) {
        expect(Object.keys(item).toSorted()).toEqual(['label', 'slug']);
      }
    }
  });

  test('no docs manifest means no topics', () => {
    expect(buildProjectTopics(project!, null)).toEqual([]);
  });
});
