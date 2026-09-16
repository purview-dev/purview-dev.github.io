import type {
  GitHubReleaseInfo,
  GitHubRepoInfo,
  NuGetSearchEntry,
  NuGetVersionIndex,
} from './types';

import { OWNER } from '../site';

const API = 'https://api.github.com';
const NUGET_FLAT = 'https://api.nuget.org/v3-flatcontainer';
const NUGET_SEARCH = 'https://azuresearch-usnc.nuget.org/query';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly source: 'github' | 'nuget',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

async function githubRequest(path: string, token?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'purview-dev-website',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API}${path}`, { headers });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new ApiError(
        `GitHub rate limited (${response.status})${retryAfter ? `; retry after ${retryAfter}s` : ''}`,
        response.status,
        'github',
      );
    }
    if (response.status === 404) {
      throw new ApiError(`GitHub resource not found: ${path}`, 404, 'github');
    }
    throw new ApiError(
      `GitHub request failed (${response.status}): ${path}`,
      response.status,
      'github',
    );
  }
  return response.json() as Promise<unknown>;
}

async function nugetRequest(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'purview-dev-website' },
  });
  if (!response.ok) {
    throw new ApiError(
      `NuGet request failed (${response.status}): ${url}`,
      response.status,
      'nuget',
    );
  }
  return response.json() as Promise<unknown>;
}

export function parseGitHubRepo(raw: Record<string, unknown>): GitHubRepoInfo {
  return {
    name: String(raw.name ?? ''),
    fullName: String(raw.full_name ?? ''),
    description: raw.description == null ? null : String(raw.description),
    archived: Boolean(raw.archived),
    homepage: raw.homepage == null ? null : String(raw.homepage),
    topics: Array.isArray(raw.topics) ? raw.topics.map(String) : [],
    stargazersCount: Number(raw.stargazers_count ?? 0),
    openIssuesCount: Number(raw.open_issues_count ?? 0),
    defaultBranch: String(raw.default_branch ?? 'main'),
    updatedAt: raw.updated_at == null ? null : String(raw.updated_at),
    hasDiscussions: Boolean(raw.has_discussions),
  };
}

export function parseGitHubRelease(raw: Record<string, unknown>): GitHubReleaseInfo {
  return {
    tagName: String(raw.tag_name ?? ''),
    name: raw.name == null ? '' : String(raw.name),
    body: raw.body == null ? '' : String(raw.body),
    prerelease: Boolean(raw.prerelease),
    draft: Boolean(raw.draft),
    publishedAt: raw.published_at == null ? null : String(raw.published_at),
    htmlUrl: String(raw.html_url ?? ''),
  };
}

export function parseNuGetIndex(raw: Record<string, unknown>, id: string): NuGetVersionIndex {
  const versions = Array.isArray(raw.versions) ? raw.versions.map(String) : [];
  return { id, versions };
}

export function parseNuGetSearchEntry(
  raw: Record<string, unknown>,
  expectedId?: string,
): NuGetSearchEntry | null {
  if (raw.id == null) {
    return null;
  }
  const id = String(raw.id);
  if (expectedId && id.toLowerCase() !== expectedId.toLowerCase()) {
    return null;
  }
  return {
    id,
    version: raw.version == null ? '' : String(raw.version),
    description: raw.description == null ? null : String(raw.description),
    totalDownloads: Number(raw.totalDownloads ?? 0),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    published: raw.published == null ? null : String(raw.published),
    deprecated: Boolean(raw.deprecated),
    listed: raw.listed === undefined ? true : Boolean(raw.listed),
  };
}

export async function fetchGitHubRepo(repository: string): Promise<GitHubRepoInfo> {
  const raw = (await githubRequest(`/repos/${repository}`, githubToken())) as Record<
    string,
    unknown
  >;
  return parseGitHubRepo(raw);
}

/** Fetch releases with pagination, bounded to `maxReleases` entries. */
export async function fetchGitHubReleases(
  repository: string,
  maxReleases = 40,
): Promise<GitHubReleaseInfo[]> {
  const token = githubToken();
  const releases: GitHubReleaseInfo[] = [];
  let page = 1;
  const perPage = 100;
  while (releases.length < maxReleases && page <= 10) {
    const remaining = maxReleases - releases.length;
    const count = Math.min(perPage, remaining);
    const raw = (await githubRequest(
      `/repos/${repository}/releases?per_page=${count}&page=${page}`,
      token,
    )) as unknown[];
    if (!Array.isArray(raw)) {
      break;
    }
    const batch = raw.map((entry) => parseGitHubRelease(entry as Record<string, unknown>));
    releases.push(...batch);
    if (batch.length < count) {
      break;
    }
    page += 1;
  }
  return releases;
}

/** Fetch the version index for a single NuGet package id. */
export async function fetchNuGetIndex(packageId: string): Promise<NuGetVersionIndex> {
  const raw = (await nugetRequest(`${NUGET_FLAT}/${packageId.toLowerCase()}/index.json`)) as Record<
    string,
    unknown
  >;
  return parseNuGetIndex(raw, packageId);
}

/** Fetch search metadata (downloads, deprecation, listed status) for a package. */
export async function fetchNuGetSearch(packageId: string): Promise<NuGetSearchEntry | null> {
  const query = encodeURIComponent(`packageid:${packageId}`);
  const raw = (await nugetRequest(`${NUGET_SEARCH}?q=${query}&take=1`)) as Record<string, unknown>;
  const data = Array.isArray(raw.data) ? raw.data : [];
  const first = data[0] as Record<string, unknown> | undefined;
  if (!first) {
    return null;
  }
  const entry = parseNuGetSearchEntry(first, packageId);
  return entry ? entry : null;
}

/** Raw (unparsed) GitHub repository response, used for fixture generation and tests. */
export async function fetchGitHubRepoRaw(repository: string): Promise<Record<string, unknown>> {
  return (await githubRequest(`/repos/${repository}`, githubToken())) as Record<string, unknown>;
}

/** Raw (unparsed) GitHub release responses, used for fixture generation and tests. */
export async function fetchGitHubReleasesRaw(
  repository: string,
  maxReleases = 40,
): Promise<Record<string, unknown>[]> {
  const token = githubToken();
  const raw: Record<string, unknown>[] = [];
  let page = 1;
  const perPage = 100;
  while (raw.length < maxReleases && page <= 10) {
    const count = Math.min(perPage, maxReleases - raw.length);
    const batch = (await githubRequest(
      `/repos/${repository}/releases?per_page=${count}&page=${page}`,
      token,
    )) as unknown[];
    if (!Array.isArray(batch)) {
      break;
    }
    raw.push(...(batch as Record<string, unknown>[]));
    if (batch.length < count) {
      break;
    }
    page += 1;
  }
  return raw;
}

/** Raw NuGet flat-container index response, used for fixture generation and tests. */
export async function fetchNuGetIndexRaw(packageId: string): Promise<Record<string, unknown>> {
  return (await nugetRequest(`${NUGET_FLAT}/${packageId.toLowerCase()}/index.json`)) as Record<
    string,
    unknown
  >;
}

/** Raw NuGet search response, used for fixture generation and tests. */
export async function fetchNuGetSearchRaw(packageId: string): Promise<Record<string, unknown>> {
  const query = encodeURIComponent(`packageid:${packageId}`);
  return (await nugetRequest(`${NUGET_SEARCH}?q=${query}&take=1`)) as Record<string, unknown>;
}

export const githubOrgUrl = `https://github.com/${OWNER}`;
