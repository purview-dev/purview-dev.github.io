import type { ResolvedProject } from '../manifest/load';
import type {
  GitHubReleaseInfo,
  PackageReleaseSummary,
  ProjectReleaseSummary,
  ReleaseCacheData,
} from './types';

import { nugetPackageUrl } from '../urls';
import {
  isPrereleaseRelease,
  normalizePrereleaseVersion,
  selectVersions,
  sortGitHubReleasesDescending,
} from './normalize';

export type DataSource = 'live' | 'cache' | 'fixture';

export interface ReleaseEntry {
  projectId: string;
  projectName: string;
  repository: string;
  archived: boolean;
  repoDescription: string | null;
  tags: string[];
  tagName: string;
  name: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
}

/**
 * Fold GitHub release tag versions into the NuGet candidate list when the
 * flat-container index has not caught up with a release. Tags already present
 * in the NuGet list are left untouched; only missing tags are appended.
 */
export function reconcileWithGitHubReleases(
  versions: string[],
  releases: GitHubReleaseInfo[],
): string[] {
  const known = new Set(versions.map(normalizePrereleaseVersion));
  const reconciled = [...versions];
  for (const release of releases) {
    const version = normalizePrereleaseVersion(release.tagName);
    if (!known.has(version)) {
      known.add(version);
      reconciled.push(version);
    }
  }
  return reconciled;
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
    // The NuGet flat-container index can lag behind a just-completed release
    // (the pipeline pushes to NuGet before creating the GitHub release), so
    // GitHub release tags missing from the NuGet list are added as candidates.
    // NuGet remains authoritative whenever it is caught up: an absent tag only
    // ever fills a gap and never outranks a version NuGet already lists. The
    // package must already exist on NuGet to reconcile, so a version is never
    // invented for a package NuGet has not published.
    const candidateVersions =
      versions.length > 0 ? reconcileWithGitHubReleases(versions, releases) : versions;
    const selection = selectVersions(candidateVersions);
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
    repoDescription: repoInfo?.description?.trim() || null,
    tags: repoInfo?.topics ?? [],
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
        repoDescription: summary.repoDescription,
        tags: summary.tags,
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
