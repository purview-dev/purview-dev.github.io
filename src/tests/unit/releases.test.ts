import type { GitHubReleaseInfo, ReleaseCacheData } from '../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadProjects } from '../../src/lib/manifest/load';
import { readReleaseFixture } from '../../src/lib/releases/cache';
import {
  parseGitHubRelease,
  parseGitHubRepo,
  parseNuGetIndex,
  parseNuGetSearchEntry,
} from '../../src/lib/releases/github';
import {
  isPrereleaseRelease,
  isPrereleaseVersion,
  isValidVersion,
  normalizePrereleaseVersion,
  selectPrereleaseVersion,
  selectStableVersion,
  selectVersions,
  sortGitHubReleasesDescending,
  sortVersionsDescending,
} from '../../src/lib/releases/normalize';
import { projectRepoEnrichment } from '../../src/lib/releases/repo';
import {
  flattenReleases,
  projectReleaseSummary,
  reconcileWithGitHubReleases,
} from '../../src/lib/releases/transform';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve('fixtures', name), 'utf8')) as unknown;
}

function fixtureReleases(name: string): GitHubReleaseInfo[] {
  return (fixture(name) as unknown[]).map((entry) =>
    parseGitHubRelease(entry as Record<string, unknown>),
  );
}

/**
 * The NuGet candidate list a release summary would derive for a package,
 * mirroring production: GitHub release tags are only folded in when the
 * package already exists on NuGet, and only when the index lacks the tag.
 */
function packageCandidates(
  packageId: string,
  repository: string,
  cache: ReleaseCacheData,
): string[] {
  const versions = cache.packages[packageId]?.versions ?? [];
  if (versions.length === 0) {
    return versions;
  }
  return reconcileWithGitHubReleases(versions, cache.releases[repository] ?? []);
}

describe('GitHub normalisation (real fixtures)', () => {
  test('parses the telemetry repo fixture', () => {
    const repo = parseGitHubRepo(
      fixture('github/repos/telemetry-sourcegenerator.json') as Record<string, unknown>,
    );
    expect(repo.fullName).toBe('purview-dev/telemetry-sourcegenerator');
    expect(repo.archived).toBe(false);
    expect(repo.hasDiscussions).toBe(false);
  });

  test('parses release fixtures including the prerelease-flag quirk', () => {
    const raw = fixture('github/releases/telemetry-sourcegenerator.json') as Array<{
      tag_name: string;
    }>;
    const releases = fixtureReleases('github/releases/telemetry-sourcegenerator.json');
    expect(releases.length).toBeGreaterThan(10);
    const latest = releases[0];
    expect(latest).toBeDefined();
    if (!latest) {
      throw new Error('The release fixture is unexpectedly empty.');
    }
    // The expectation follows the fixture head instead of a pinned tag, so a
    // fixture refresh never invalidates this test.
    expect(latest.tagName).toBe(raw[0]?.tag_name ?? '');
    // The org publishes prerelease tags with the GitHub prerelease flag set to
    // false; classification must follow the semver tag, not the flag.
    expect(latest.prerelease).toBe(false);
    expect(isPrereleaseRelease(latest)).toBe(true);
  });
});

describe('NuGet normalisation (real fixtures)', () => {
  test('parses the flat-container index for Purview.Telemetry.SourceGenerator', () => {
    const index = parseNuGetIndex(
      fixture('nuget/purview.telemetry.sourcegenerator.json') as Record<string, unknown>,
      'Purview.Telemetry.SourceGenerator',
    );
    expect(index.versions).toContain('4.4.0');
    expect(index.versions).toContain('5.0.0-prerelease.8');
  });

  test('parses the search entry with download counts', () => {
    const raw = fixture('nuget/search/Purview.Build.json') as Record<string, unknown>;
    const data = Array.isArray(raw.data) ? raw.data : [];
    const entry = parseNuGetSearchEntry(data[0] as Record<string, unknown>);
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe('Purview.Build');
    expect(typeof entry?.totalDownloads).toBe('number');
  });

  test('returns null when the search result id does not match the expected package', () => {
    expect(
      parseNuGetSearchEntry({ id: 'SomethingElse', version: '1.0.0' }, 'Purview.Build'),
    ).toBeNull();
    expect(
      parseNuGetSearchEntry({ id: 'Purview.Build', version: '0.2.4' }, 'purview.build'),
    ).not.toBeNull();
  });
});

describe('version selection (semver)', () => {
  test('handles the changesets prerelease-flag quirk via tags', () => {
    const versions = ['4.4.0', '5.0.0-prerelease.1', '5.0.0-prerelease.8', '4.3.0'];
    expect(selectStableVersion(versions)).toBe('4.4.0');
    expect(selectPrereleaseVersion(versions)).toBe('5.0.0-prerelease.8');
    expect(selectVersions(versions)).toEqual({
      stable: '4.4.0',
      prerelease: '5.0.0-prerelease.8',
    });
  });

  test('handles a package with only prereleases', () => {
    const versions = ['2.0.0-prerelease.1', '2.0.0-prerelease.32'];
    expect(selectStableVersion(versions)).toBeNull();
    expect(selectPrereleaseVersion(versions)).toBe('2.0.0-prerelease.32');
  });

  test('normalises the historical "reprelease" typo as a prerelease', () => {
    const versions = ['1.0.0-reprelease.0', '0.9.0'];
    expect(selectStableVersion(versions)).toBe('0.9.0');
    expect(selectPrereleaseVersion(versions)).toBe('1.0.0-prerelease.0');
  });

  test('real prereleases outrank the historical "reprelease" typo', () => {
    const versions = ['1.0.0-reprelease.0', '1.0.0-prerelease.1', '1.0.0-prerelease.55'];
    expect(selectPrereleaseVersion(versions)).toBe('1.0.0-prerelease.55');
  });

  test('selects the latest prerelease for the BuildSdk fixture', () => {
    const index = parseNuGetIndex(
      fixture('nuget/purview.buildsdk.json') as Record<string, unknown>,
      'Purview.BuildSdk',
    );
    expect(index.versions.length).toBeGreaterThan(0);
    expect(index.versions.some((version) => isPrereleaseVersion(version))).toBe(true);
    const selection = selectVersions(index.versions);
    expect(selection.stable).toBeNull();
    // The package only publishes prereleases, so the latest prerelease must be
    // the highest semver version in the fixture's flat-container index.
    expect(selection.prerelease).toBe(sortVersionsDescending(index.versions)[0] ?? null);
  });

  test('handles a package with no releases at all', () => {
    expect(selectStableVersion([])).toBeNull();
    expect(selectPrereleaseVersion([])).toBeNull();
  });

  test('strips a leading v prefix and sorts descending', () => {
    expect(isValidVersion('v2.0.0-prerelease.32')).toBe(true);
    expect(isPrereleaseVersion('v2.0.0-prerelease.32')).toBe(true);
    expect(sortVersionsDescending(['1.0.0', 'v2.0.0', '1.2.3', 'not-a-version'])).toEqual([
      '2.0.0',
      '1.2.3',
      '1.0.0',
    ]);
  });

  test('classifies a non-semver GitHub release by its flag', () => {
    const flagged = parseGitHubRelease({ tag_name: 'nightly', prerelease: true });
    expect(isPrereleaseRelease(flagged)).toBe(true);
    const regular = parseGitHubRelease({ tag_name: 'v1.0.0', prerelease: false });
    expect(isPrereleaseRelease(regular)).toBe(false);
  });

  test('sorts GitHub releases by semver tag descending', () => {
    const releases = [
      parseGitHubRelease({ tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z' }),
      parseGitHubRelease({ tag_name: 'v2.0.0-prerelease.5', published_at: '2026-06-01T00:00:00Z' }),
      parseGitHubRelease({ tag_name: 'v1.1.1', published_at: '2026-04-01T00:00:00Z' }),
    ];
    const sorted = sortGitHubReleasesDescending(releases);
    expect(sorted.map((release) => release.tagName)).toEqual([
      'v2.0.0-prerelease.5',
      'v1.1.1',
      'v1.0.0',
    ]);
  });
});

describe('project/package association and release summaries', () => {
  test('enriches a project with repo description and tags', () => {
    const cache = readReleaseFixture('index');
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const enrichment = projectRepoEnrichment(telemetry!, cache!);
    expect(enrichment.repoDescription).toContain('source generator');
    expect(enrichment.tags.length).toBeGreaterThan(0);
    // The manifest short description remains the source of truth.
    expect(enrichment.shortDescription).toBe(telemetry!.shortDescription);
  });

  test('falls back to the repo description when the manifest short description is empty', () => {
    const cache = readReleaseFixture('index');
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const enrichment = projectRepoEnrichment({ ...telemetry!, shortDescription: '' }, cache!);
    expect(enrichment.repoDescription).not.toBeNull();
    expect(enrichment.shortDescription).toBe(enrichment.repoDescription ?? '');
  });

  test('builds a summary from the committed release fixture', () => {
    const cache = readReleaseFixture('index');
    expect(cache).not.toBeNull();
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const sorted = sortGitHubReleasesDescending(cache!.releases[telemetry!.repository] ?? []);
    const summary = projectReleaseSummary(telemetry!, cache!, 'fixture');
    // Expectations are derived from the cache so a fixture refresh never
    // invalidates this test; it still verifies the summary picks the same
    // releases and package versions the normalisation helpers identify.
    expect(summary.latestRelease?.tagName).toBe(sorted[0]?.tagName);
    expect(summary.latestStableRelease?.tagName).toBe(
      sorted.find((release) => !isPrereleaseRelease(release))?.tagName,
    );
    expect(summary.repoDescription).toContain('source generator');
    expect(summary.tags.length).toBeGreaterThan(0);
    expect(summary.tags).toContain('observability');
    const pkg = summary.packages.find(
      (entry) => entry.packageId === 'Purview.Telemetry.SourceGenerator',
    );
    const candidates = packageCandidates(
      'Purview.Telemetry.SourceGenerator',
      telemetry!.repository,
      cache!,
    );
    expect(pkg?.latestStable).toBe(selectStableVersion(candidates));
    expect(pkg?.latestPrerelease).toBe(selectPrereleaseVersion(candidates));
    expect(pkg?.totalDownloads).toBeGreaterThan(0);
  });

  test('flattens release entries across projects', () => {
    const cache = readReleaseFixture('index');
    const projects = loadProjects();
    const summaries = projects.map((project) => projectReleaseSummary(project, cache!, 'fixture'));
    const entries = flattenReleases(summaries);
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.some((entry) => entry.projectId === 'telemetry-sourcegenerator')).toBe(true);
    expect(entries.some((entry) => entry.projectId === 'event-sourcing')).toBe(true);
    expect(entries.some((entry) => entry.prerelease)).toBe(true);
    expect(entries.some((entry) => !entry.prerelease)).toBe(true);
    expect(entries.some((entry) => entry.tags.length > 0)).toBe(true);
  });

  test('treats archived repos correctly', () => {
    const cache = readReleaseFixture('index');
    const projects = loadProjects();
    const archived = projects.find((project) => project.id === 'dotnet-logging-source-generators');
    const summary = projectReleaseSummary(archived!, cache!, 'fixture');
    expect(summary.archived).toBe(true);
  });
});

describe('NuGet index lag reconciliation', () => {
  const PACKAGE = 'Purview.Telemetry.SourceGenerator';
  const REPOSITORY = 'purview-dev/telemetry-sourcegenerator';

  /** The most recent prerelease GitHub tag; derived so refreshes stay accurate. */
  function laggingPrerelease(cache: ReleaseCacheData): { tag: string; version: string } {
    const sorted = sortGitHubReleasesDescending(cache.releases[REPOSITORY] ?? []);
    const latest = sorted.find((release) => isPrereleaseRelease(release));
    const tag = latest?.tagName ?? '';
    return { tag, version: normalizePrereleaseVersion(tag) };
  }

  function laggedCache(): ReleaseCacheData {
    const cache = readReleaseFixture('index');
    expect(cache).not.toBeNull();
    const { tag: laggingTag, version: laggingVersion } = laggingPrerelease(cache!);
    const releases = cache!.releases[REPOSITORY] ?? [];
    const packageIndex = cache!.packages[PACKAGE] ?? { id: PACKAGE, versions: [] };
    // Drop the latest prerelease from the NuGet index while the GitHub release
    // for it still exists, simulating the flat-container index lagging behind
    // a just-completed release (publish runs before the GitHub release is cut).
    return {
      ...cache!,
      releases: {
        ...cache!.releases,
        [REPOSITORY]: [
          parseGitHubRelease({ tag_name: laggingTag, prerelease: false }),
          ...releases,
        ],
      },
      packages: {
        ...cache!.packages,
        [PACKAGE]: {
          id: PACKAGE,
          versions: packageIndex.versions.filter((version) => version !== laggingVersion),
        },
      },
    };
  }

  test('surfaces a GitHub prerelease tag missing from the NuGet index', () => {
    const cache = readReleaseFixture('index');
    expect(cache).not.toBeNull();
    const { version: laggingVersion } = laggingPrerelease(cache!);
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const summary = projectReleaseSummary(telemetry!, laggedCache(), 'fixture');
    const pkg = summary.packages.find((entry) => entry.packageId === PACKAGE);
    // The dropped tag is folded back in from GitHub, so the lagging prerelease
    // is still surfaced as the latest.
    expect(pkg?.latestPrerelease).toBe(laggingVersion);
    // The stable selection is unaffected by the lag.
    expect(pkg?.latestStable).toBe(
      selectStableVersion(packageCandidates(PACKAGE, REPOSITORY, cache!)),
    );
  });

  test('surfaces a GitHub stable tag missing from the NuGet index', () => {
    const cache = laggedCache();
    const { version: laggingVersion } = laggingPrerelease(cache);
    // Simulate a just-cut GitHub stable tag that NuGet has not published yet.
    const stableVersion = selectStableVersion(cache.packages[PACKAGE]?.versions ?? []) ?? '4.4.0';
    const stableTag = `v${stableVersion}`;
    cache.releases[REPOSITORY] = [
      parseGitHubRelease({ tag_name: stableTag, prerelease: false }),
      ...(cache.releases[REPOSITORY] ?? []),
    ];
    const packageIndex = cache.packages[PACKAGE] ?? { id: PACKAGE, versions: [] };
    cache.packages[PACKAGE] = {
      id: PACKAGE,
      versions: packageIndex.versions.filter((version) => version !== stableVersion),
    };
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const summary = projectReleaseSummary(telemetry!, cache, 'fixture');
    const pkg = summary.packages.find((entry) => entry.packageId === PACKAGE);
    expect(pkg?.latestStable).toBe(stableVersion);
    expect(pkg?.latestPrerelease).toBe(laggingVersion);
  });

  test('does not invent versions for packages NuGet has never published', () => {
    const cache = laggedCache();
    cache.packages[PACKAGE] = { id: PACKAGE, versions: [] };
    const projects = loadProjects();
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const summary = projectReleaseSummary(telemetry!, cache, 'fixture');
    const pkg = summary.packages.find((entry) => entry.packageId === PACKAGE);
    expect(pkg?.latestStable).toBeNull();
    expect(pkg?.latestPrerelease).toBeNull();
    expect(pkg?.hasAnyRelease).toBe(false);
  });
});
