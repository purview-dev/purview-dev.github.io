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
  selectPrereleaseVersion,
  selectStableVersion,
  selectVersions,
  sortGitHubReleasesDescending,
  sortVersionsDescending,
} from '../../src/lib/releases/normalize';
import { projectRepoEnrichment } from '../../src/lib/releases/repo';
import { flattenReleases, projectReleaseSummary } from '../../src/lib/releases/transform';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve('fixtures', name), 'utf8')) as unknown;
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
    const releases = (fixture('github/releases/telemetry-sourcegenerator.json') as unknown[]).map(
      (entry) => parseGitHubRelease(entry as Record<string, unknown>),
    );
    expect(releases.length).toBeGreaterThan(10);
    const latest = releases[0];
    expect(latest).toBeDefined();
    if (!latest) {
      throw new Error('The release fixture is unexpectedly empty.');
    }
    expect(latest.tagName).toBe('v5.0.0-prerelease.8');
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

  test('selects the latest prerelease for the DotNetProjectSdk fixture', () => {
    const index = parseNuGetIndex(
      fixture('nuget/purview.dotnetprojectsdk.json') as Record<string, unknown>,
      'Purview.DotNetProjectSdk',
    );
    expect(index.versions).toContain('1.0.0-reprelease.0');
    expect(selectVersions(index.versions)).toEqual({
      stable: null,
      prerelease: '1.0.0-prerelease.55',
    });
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
    const summary = projectReleaseSummary(telemetry!, cache!, 'fixture');
    expect(summary.latestRelease?.tagName).toBe('v5.0.0-prerelease.8');
    expect(summary.latestStableRelease?.tagName).toBe('v4.1.0');
    expect(summary.repoDescription).toContain('source generator');
    expect(summary.tags.length).toBeGreaterThan(0);
    expect(summary.tags).toContain('observability');
    const pkg = summary.packages.find(
      (entry) => entry.packageId === 'Purview.Telemetry.SourceGenerator',
    );
    expect(pkg?.latestStable).toBe('4.4.0');
    expect(pkg?.latestPrerelease).toBe('5.0.0-prerelease.8');
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
