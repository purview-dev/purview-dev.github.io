import type { ResolvedProject } from '../manifest/load';
import type {
  GitHubReleaseInfo,
  PackageReleaseSummary,
  ProjectReleaseSummary,
  ReleaseCacheData,
} from './types';

import { nugetPackageUrl } from '../urls';
import { isPrereleaseRelease, selectVersions, sortGitHubReleasesDescending } from './normalize';

export type DataSource = 'live' | 'cache' | 'fixture';

export interface ReleaseEntry {
  projectId: string;
  projectName: string;
  repository: string;
  archived: boolean;
  tagName: string;
  name: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
}

/** Build the release summary for a single catalogue project. */
export function projectReleaseSummary(
  project: ResolvedProject,
  cache: ReleaseCacheData,
  dataSource: DataSource,
): ProjectReleaseSummary {
  const repoInfo = cache.repos[project.repository];
  const releases = sortGitHubReleasesDescending(cache.releases[project.repository] ?? []);
  const latestRelease = releases[0] ?? null;
  const latestStable = releases.find((release) => !isPrereleaseRelease(release)) ?? null;
  const latestPrerelease = releases.find((release) => isPrereleaseRelease(release)) ?? null;

  const packages: PackageReleaseSummary[] = project.packages.map((pkg) => {
    const index = cache.packages[pkg.id];
    const search = cache.packageSearch[pkg.id] ?? null;
    const versions = index?.versions ?? [];
    const selection = selectVersions(versions);
    return {
      packageId: pkg.id,
      description: pkg.description ?? search?.description ?? null,
      latestStable: selection.stable,
      latestPrerelease: selection.prerelease,
      totalDownloads: search?.totalDownloads ?? null,
      deprecated: search?.deprecated ?? false,
      listed: search?.listed ?? true,
      hasAnyRelease: versions.length > 0,
      nugetUrl: nugetPackageUrl(pkg.id),
    };
  });

  return {
    projectId: project.id,
    projectName: project.name,
    repository: project.repository,
    archived: repoInfo?.archived ?? project.status === 'archived',
    latestRelease,
    latestStableRelease: latestStable,
    latestPrereleaseRelease: latestPrerelease,
    releaseCount: releases.length,
    packages,
    retrievedAt: cache.retrievedAt,
    dataSource,
  };
}

/** Flatten per-project summaries into a single, filterable release list. */
export function flattenReleases(summaries: ProjectReleaseSummary[]): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  for (const summary of summaries) {
    const all = [
      ...(summary.latestStableRelease ? [summary.latestStableRelease] : []),
      ...(summary.latestPrereleaseRelease ? [summary.latestPrereleaseRelease] : []),
      ...(summary.latestRelease ? [summary.latestRelease] : []),
    ];
    const unique = new Map<string, GitHubReleaseInfo>();
    for (const release of all) {
      unique.set(release.tagName, release);
    }
    for (const release of unique.values()) {
      entries.push({
        projectId: summary.projectId,
        projectName: summary.projectName,
        repository: summary.repository,
        archived: summary.archived,
        tagName: release.tagName,
        name: release.name,
        publishedAt: release.publishedAt,
        url: release.htmlUrl,
        prerelease: isPrereleaseRelease(release),
      });
    }
  }
  return entries.toSorted((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

export type { ProjectReleaseSummary };
