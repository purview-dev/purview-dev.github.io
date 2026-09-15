export const RELEASE_CACHE_SCHEMA_VERSION = 1;

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

export interface ReleaseCacheData {
  schema: typeof RELEASE_CACHE_SCHEMA_VERSION;
  retrievedAt: string;
  repos: Record<string, GitHubRepoInfo>;
  releases: Record<string, GitHubReleaseInfo[]>;
  packages: Record<string, NuGetVersionIndex>;
  packageSearch: Record<string, NuGetSearchEntry | null>;
}

export type VersionSelection = {
  stable: string | null;
  prerelease: string | null;
};

export interface PackageReleaseSummary {
  packageId: string;
  description: string | null;
  latestStable: string | null;
  latestPrerelease: string | null;
  totalDownloads: number | null;
  deprecated: boolean;
  listed: boolean;
  hasAnyRelease: boolean;
  nugetUrl: string;
}

export interface ProjectReleaseSummary {
  projectId: string;
  projectName: string;
  repository: string;
  archived: boolean;
  latestRelease: GitHubReleaseInfo | null;
  latestStableRelease: GitHubReleaseInfo | null;
  latestPrereleaseRelease: GitHubReleaseInfo | null;
  releaseCount: number;
  packages: PackageReleaseSummary[];
  retrievedAt: string;
  dataSource: 'live' | 'cache' | 'fixture';
}
