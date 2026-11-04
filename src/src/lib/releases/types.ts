import type { PackageRegistry } from '../manifest/schema';

export const RELEASE_CACHE_SCHEMA_VERSION = 3;

export interface GitHubRepoInfo {
  name: string;
  fullName: string;
  description: string | null;
  archived: boolean;
  homepage: string | null;
  topics: string[];
  stargazersCount: number;
  openIssuesCount: number;
  defaultBranch: string;
  updatedAt: string | null;
  hasDiscussions: boolean;
}

export interface GitHubReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string | null;
  htmlUrl: string;
}

export interface NuGetVersionIndex {
  id: string;
  versions: string[];
  /**
   * Target frameworks of the package's newest stable version (falling back to
   * the newest prerelease when no stable version exists), read from the NuGet
   * flat-container `.nuspec`. Absent when the package has no published versions
   * or the nuspec could not be read.
   */
  targetFrameworks?: string[];
  /** The published version `targetFrameworks` was read from. */
  targetFrameworksVersion?: string | null;
}

export interface NuGetSearchEntry {
  id: string;
  version: string;
  description: string | null;
  totalDownloads: number;
  tags: string[];
  published: string | null;
  deprecated: boolean;
  listed: boolean;
}

/**
 * The npm registry's view of a package: every published version (the keys of
 * the registry document), the dist-tags that name the release channels, the
 * publish date of the newest version and its weekly downloads.
 *
 * npm has no flat-container equivalent, so the version list and the channel
 * tags come from one document. `distTags` is what makes `latest` meaningful:
 * a package can publish `1.0.0-prerelease.4` while `latest` still resolves an
 * older stable version, and the catalogue must not call that stable.
 */
export interface NpmPackageIndex {
  name: string;
  versions: string[];
  distTags: Record<string, string>;
  /** Publish date of the newest version, when the registry reports one. */
  publishedAt: string | null;
  /** Weekly downloads, or null when the downloads API could not be read. */
  weeklyDownloads: number | null;
  /** True when npm marks the version `latest` resolves as deprecated. */
  deprecated: boolean;
}

export interface ReleaseCacheData {
  schema: typeof RELEASE_CACHE_SCHEMA_VERSION;
  retrievedAt: string;
  repos: Record<string, GitHubRepoInfo>;
  releases: Record<string, GitHubReleaseInfo[]>;
  packages: Record<string, NuGetVersionIndex>;
  packageSearch: Record<string, NuGetSearchEntry | null>;
  npmPackages: Record<string, NpmPackageIndex>;
}

export type VersionSelection = {
  stable: string | null;
  prerelease: string | null;
};

export interface PackageReleaseSummary {
  packageId: string;
  /** The registry the versions and the package page come from. */
  registry: PackageRegistry;
  description: string | null;
  latestStable: string | null;
  latestPrerelease: string | null;
  /** Total downloads (NuGet) or weekly downloads (npm). */
  downloads: number | null;
  downloadsPeriod: 'total' | 'weekly';
  deprecated: boolean;
  listed: boolean;
  hasAnyRelease: boolean;
  /** The registry's page for the package (nuget.org or npmjs.com). */
  packageUrl: string;
}

export interface ProjectReleaseSummary {
  projectId: string;
  projectName: string;
  repository: string;
  archived: boolean;
  /** GitHub repository description, when available (supplements the manifest). */
  repoDescription: string | null;
  /** GitHub repository topics, used as content tags. */
  tags: string[];
  latestRelease: GitHubReleaseInfo | null;
  latestStableRelease: GitHubReleaseInfo | null;
  latestPrereleaseRelease: GitHubReleaseInfo | null;
  releaseCount: number;
  packages: PackageReleaseSummary[];
  retrievedAt: string;
  dataSource: 'live' | 'cache' | 'fixture';
}
