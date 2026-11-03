import type { ResolvedProject } from '../../src/lib/manifest/load';
import type { ProjectDocsConfig } from '../../src/lib/manifest/schema';
import type { ReleaseCacheData } from '../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';

import {
  channelBasePath,
  channelDisplayLabel,
  channelLayout,
  channelTopicLabel,
  prereleaseChannelGate,
  prereleaseLinePromoted,
  projectReleaseLine,
  releaseDateForRef,
  resolveChannelRef,
  resolveDocChannels,
} from '../../src/lib/docs/channels';
import { loadProjects } from '../../src/lib/manifest/load';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../../src/lib/releases/types';

const REPOSITORY = 'purview-dev/zodsharp';

/** A real catalogue record, so the synthetic docs blocks carry realistic defaults. */
function project(docs: ProjectDocsConfig | undefined): ResolvedProject {
  const base = loadProjects().find((candidate) => candidate.id === 'zodsharp');
  if (!base) {
    throw new Error('the catalogue must define zodsharp for these tests');
  }
  return { ...base, docs };
}

function docsConfig(channels?: {
  live?: { ref?: string };
  prerelease?: { ref?: string };
}): ProjectDocsConfig {
  return {
    source: 'github-path',
    path: 'docs/wiki',
    rootPage: 'Getting-Started.md',
    exclude: ['_Sidebar.md', 'Home.md', 'index.md'],
    ...(channels ? { channels } : {}),
  };
}

interface ReleaseInput {
  tagName: string;
  prerelease?: boolean;
  publishedAt?: string | null;
}

function releaseData(
  releases: ReleaseInput[] = [],
  options: { defaultBranch?: string; packages?: Record<string, string[]> } = {},
): ReleaseCacheData {
  return {
    schema: RELEASE_CACHE_SCHEMA_VERSION,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    repos: {
      [REPOSITORY]: {
        name: 'zodsharp',
        fullName: REPOSITORY,
        description: null,
        archived: false,
        homepage: null,
        topics: [],
        stargazersCount: 0,
        openIssuesCount: 0,
        defaultBranch: options.defaultBranch ?? 'main',
        updatedAt: null,
        hasDiscussions: false,
      },
    },
    releases: {
      [REPOSITORY]: releases.map((release) => ({
        tagName: release.tagName,
        name: release.tagName,
        body: '',
        prerelease: release.prerelease ?? false,
        draft: false,
        publishedAt: release.publishedAt ?? null,
        htmlUrl: `https://github.com/${REPOSITORY}/releases/tag/${release.tagName}`,
      })),
    },
    packages: Object.fromEntries(
      Object.entries(options.packages ?? {}).map(([id, versions]) => [id, { id, versions }]),
    ),
    packageSearch: {},
  };
}

const ZODSHARP_RELEASES: ReleaseInput[] = [
  { tagName: 'v3.0.0-prerelease.2', prerelease: true, publishedAt: '2026-11-02T10:00:00Z' },
  { tagName: 'v2.4.2', publishedAt: '2026-10-16T10:03:37Z' },
  { tagName: 'v2.4.1', publishedAt: '2026-10-08T18:09:19Z' },
];

describe('documentation channels', () => {
  test('a project without `channels` keeps one live channel on the default branch', () => {
    const { channels, warnings } = resolveDocChannels(project(docsConfig()), releaseData());
    expect(warnings).toEqual([]);
    expect(channels).toEqual([
      { id: 'live', ref: 'main', refKind: 'branch', version: null, label: 'main', default: true },
    ]);
  });

  test('pin live to the latest stable release and prerelease to the default branch', () => {
    const { channels, warnings } = resolveDocChannels(
      project(docsConfig({ live: { ref: 'latest-stable' }, prerelease: { ref: 'default' } })),
      releaseData(ZODSHARP_RELEASES),
    );
    expect(warnings).toEqual([]);
    expect(channels.map((channel) => channel.id)).toEqual(['live', 'prerelease']);
    expect(channels[0]).toMatchObject({
      id: 'live',
      ref: 'v2.4.2',
      refKind: 'tag',
      version: '2.4.2',
      label: '2.4.2',
      default: true,
    });
    expect(channels[1]).toMatchObject({
      id: 'prerelease',
      ref: 'main',
      refKind: 'branch',
      // The channel follows `main`, but it documents the version that line
      // ships: a reader chooses between versions, not branch names. The ref stays
      // on the record for the tooltip and the edit links.
      version: '3.0.0-prerelease.2',
      label: '3.0.0-prerelease.2',
      default: false,
    });
    expect(channelDisplayLabel(channels[1]!)).toBe('Prerelease 3.0.0-prerelease.2');
  });

  test('live falls back to the default branch when no stable release exists', () => {
    const { channels, warnings } = resolveDocChannels(
      project(docsConfig({ live: { ref: 'latest-stable' } })),
      releaseData([{ tagName: 'v1.0.0-prerelease.1', prerelease: true }]),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      id: 'live',
      ref: 'main',
      refKind: 'branch',
      default: true,
    });
    expect(warnings.join(' ')).toContain('no such release');
  });

  test('a prerelease channel with no matching release is skipped', () => {
    const { channels, warnings } = resolveDocChannels(
      project(
        docsConfig({ live: { ref: 'latest-stable' }, prerelease: { ref: 'latest-prerelease' } }),
      ),
      releaseData([{ tagName: 'v2.4.2' }]),
    );
    expect(channels.map((channel) => channel.id)).toEqual(['live']);
    expect(warnings.join(' ')).toContain('prerelease documentation is pinned');
  });

  test('a project whose only channel resolves to nothing still publishes its docs', () => {
    const { channels, warnings } = resolveDocChannels(
      project(docsConfig({ prerelease: { ref: 'latest-prerelease' } })),
      releaseData([{ tagName: 'v2.4.2' }]),
    );
    expect(channels).toEqual([
      { id: 'live', ref: 'main', refKind: 'branch', version: null, label: 'main', default: true },
    ]);
    expect(warnings.join(' ')).toContain('every declared channel was skipped');
  });

  test('two channels that resolve to the same ref collapse to the default one', () => {
    // This is the promotion case: `main` and the released tag are the same line,
    // so a second channel would publish an identical copy.
    const { channels, warnings } = resolveDocChannels(
      project(docsConfig({ live: { ref: 'main' }, prerelease: { ref: 'default' } })),
      releaseData(ZODSHARP_RELEASES),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ id: 'live', default: true });
    expect(warnings.join(' ')).toContain('duplicate');
  });

  test('a prerelease-only project serves its docs at the canonical URLs', () => {
    const { channels } = resolveDocChannels(
      project(docsConfig({ prerelease: { ref: 'default' } })),
      releaseData(ZODSHARP_RELEASES),
    );
    expect(channels).toEqual([
      {
        id: 'prerelease',
        ref: 'main',
        refKind: 'branch',
        version: '3.0.0-prerelease.2',
        label: '3.0.0-prerelease.2',
        default: true,
      },
    ]);
  });

  test('a commit-pinned prerelease channel keeps the commit label', () => {
    // A SHA is frozen, so there is no release line to name: the commit stays the
    // most honest label the switcher can show.
    const { channels } = resolveDocChannels(
      project(docsConfig({ prerelease: { ref: 'd0dbc74417d4445226a58ef96464d4d3519bd3c4' } })),
      releaseData(ZODSHARP_RELEASES),
    );
    expect(channels[0]).toMatchObject({
      id: 'prerelease',
      refKind: 'sha',
      version: null,
      label: 'd0dbc74',
    });
  });

  test('explicit refs keep their kind and display label', () => {
    const cache = releaseData(ZODSHARP_RELEASES);
    const tag = resolveChannelRef(project(docsConfig()), cache, 'v2.4.2');
    expect(tag).toMatchObject({ ref: 'v2.4.2', refKind: 'tag', version: '2.4.2', label: '2.4.2' });
    const branch = resolveChannelRef(project(docsConfig()), cache, 'release/2.x');
    expect(branch).toMatchObject({ ref: 'release/2.x', refKind: 'branch', label: 'release/2.x' });
    const sha = resolveChannelRef(
      project(docsConfig()),
      cache,
      'd0dbc74417d4445226a58ef96464d4d3519bd3c4',
    );
    expect(sha).toMatchObject({ refKind: 'sha', label: 'd0dbc74' });
  });

  test('the default branch comes from the release cache rather than a hard-coded main', () => {
    const { channels } = resolveDocChannels(
      project(docsConfig()),
      releaseData(ZODSHARP_RELEASES, { defaultBranch: 'trunk' }),
    );
    expect(channels[0]?.ref).toBe('trunk');
    expect(channels[0]?.label).toBe('trunk');
  });

  test('a per-channel layout overrides the shared docs block on that channel only', () => {
    const withOverrides = project({
      source: 'github-path',
      path: 'docs/wiki',
      rootPage: 'Getting-Started.md',
      channels: {
        live: { ref: 'latest-stable' },
        prerelease: { ref: 'default', path: 'docs', rootPage: 'Home.md' },
      },
    });
    const resolved = resolveDocChannels(withOverrides, releaseData(ZODSHARP_RELEASES)).channels;
    expect(resolved).toHaveLength(2);
    expect(channelLayout(withOverrides, resolved[0]!)?.path).toBe('docs/wiki');
    expect(channelLayout(withOverrides, resolved[1]!)).toMatchObject({
      path: 'docs',
      rootPage: 'Home.md',
    });
  });

  test('a pinned release dates its pages with the release date', () => {
    const cache = releaseData(ZODSHARP_RELEASES);
    expect(releaseDateForRef(project(docsConfig()), cache, 'v2.4.2')).toBe('2026-10-16');
    expect(releaseDateForRef(project(docsConfig()), cache, 'v9.9.9')).toBeNull();
  });

  test('channel labels and URLs match the portal contract', () => {
    expect(channelDisplayLabel({ id: 'live', label: '2.4.2' })).toBe('Live 2.4.2');
    expect(channelDisplayLabel({ id: 'prerelease', label: 'main' })).toBe('Prerelease main');
    expect(channelBasePath('zodsharp', 'live', true)).toBe('/docs/zodsharp/');
    expect(channelBasePath('zodsharp', 'prerelease', false)).toBe('/docs/zodsharp/prerelease/');
  });

  test('each version gets its own sidebar topic label', () => {
    // Same product, different versions: the product name stays, the version
    // distinguishes the topics.
    expect(channelTopicLabel('ZodSharp', { label: '2.4.2' }, 2)).toBe('ZodSharp 2.4.2');
    expect(channelTopicLabel('ZodSharp', { label: '3.0.0-prerelease.2' }, 2)).toBe(
      'ZodSharp 3.0.0-prerelease.2',
    );
    // A single-channel project keeps the historical bare name.
    expect(channelTopicLabel('ZodSharp', { label: '2.4.2' }, 1)).toBe('ZodSharp');
  });
});

describe('automatic promotion from release data', () => {
  const bothChannels = docsConfig({
    live: { ref: 'latest-stable' },
    prerelease: { ref: 'default' },
  });

  test('the release line takes the highest stable and prerelease from GitHub and NuGet', () => {
    const cache = releaseData(
      [
        { tagName: 'v2.4.2' },
        { tagName: 'v3.1.0-prerelease.1', prerelease: true, publishedAt: '2026-12-01T00:00:00Z' },
      ],
      { packages: { 'Purview.ZodSharp': ['2.4.2', '3.0.0-prerelease.2'] } },
    );
    expect(projectReleaseLine(project(docsConfig()), cache)).toEqual({
      stable: '2.4.2',
      prerelease: '3.1.0-prerelease.1',
    });
  });

  test('a trailing prerelease is not an outstanding line', () => {
    const cache = releaseData([
      { tagName: 'v2.0.0-prerelease.5', prerelease: true },
      { tagName: 'v2.4.2' },
    ]);
    expect(projectReleaseLine(project(docsConfig()), cache).prerelease).toBeNull();
    expect(prereleaseLinePromoted(project(docsConfig()), cache).publish).toBe(false);
  });

  test('publishing the stable release retires the prerelease channel automatically', () => {
    const promoted = resolveDocChannels(
      project(bothChannels),
      releaseData([
        { tagName: 'v3.0.0', publishedAt: '2026-12-10T00:00:00Z' },
        { tagName: 'v3.0.0-prerelease.2', prerelease: true },
      ]),
    );
    expect(promoted.channels.map((channel) => channel.id)).toEqual(['live']);
    expect(promoted.channels[0]).toMatchObject({ ref: 'v3.0.0', default: true });
    expect(promoted.warnings.join(' ')).toContain('has caught up with 3.0.0-prerelease.2');
  });

  test('an explicitly pinned prerelease tag is retired by the same rule', () => {
    const pinned = resolveDocChannels(
      project(
        docsConfig({ live: { ref: 'latest-stable' }, prerelease: { ref: 'v3.0.0-prerelease.2' } }),
      ),
      releaseData([{ tagName: 'v3.0.0' }, { tagName: 'v3.0.0-prerelease.2', prerelease: true }]),
    );
    expect(pinned.channels.map((channel) => channel.id)).toEqual(['live']);
  });

  test('the channel returns with the next prerelease release', () => {
    const returned = resolveDocChannels(
      project(bothChannels),
      releaseData([{ tagName: 'v3.0.0' }, { tagName: 'v3.1.0-prerelease.1', prerelease: true }]),
    );
    expect(returned.channels.map((channel) => channel.id)).toEqual(['live', 'prerelease']);
  });

  test('NuGet alone can keep the channel alive and alone can promote it', () => {
    // GitHub has only the stable tag; the next line exists on NuGet.
    const kept = resolveDocChannels(
      project(bothChannels),
      releaseData([{ tagName: 'v2.4.2' }], {
        packages: { 'Purview.ZodSharp': ['2.4.2', '3.0.0-prerelease.2'] },
      }),
    );
    expect(kept.channels.map((channel) => channel.id)).toEqual(['live', 'prerelease']);

    const promoted = releaseData([], { packages: { 'Purview.ZodSharp': ['2.4.2', '3.0.0'] } });
    expect(prereleaseLinePromoted(project(docsConfig()), promoted).publish).toBe(false);
    expect(
      prereleaseChannelGate(project(docsConfig()), promoted, {
        id: 'prerelease',
        refKind: 'branch',
        version: null,
      }).publish,
    ).toBe(false);
  });
});
