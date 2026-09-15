import type { ReleaseCacheData } from '../src/lib/releases/types';

import { loadProjects } from '../src/lib/manifest/load';
import { readReleaseCache, writeReleaseCache } from '../src/lib/releases/cache';
import {
  fetchGitHubReleases,
  fetchGitHubRepo,
  fetchNuGetIndex,
  fetchNuGetSearch,
} from '../src/lib/releases/github';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../src/lib/releases/types';

export async function fetchReleaseData(): Promise<ReleaseCacheData> {
  const projects = loadProjects();
  const existing = readReleaseCache();
  const data: ReleaseCacheData = {
    schema: RELEASE_CACHE_SCHEMA_VERSION,
    retrievedAt: new Date().toISOString(),
    repos: {},
    releases: {},
    packages: {},
    packageSearch: {},
  };

  let githubRefreshed = 0;
  let nugetRefreshed = 0;

  for (const project of projects) {
    const repository = project.repository;
    try {
      data.repos[repository] = await fetchGitHubRepo(repository);
      const releases = await fetchGitHubReleases(repository);
      data.releases[repository] = releases;
      githubRefreshed += 1;
      console.log(`  github ${repository}: ${releases.length} releases`);
    } catch (error) {
      // Preserve previously fetched data for this repository instead of
      // replacing it with an empty record on a transient upstream failure.
      const previous = existing?.repos[repository];
      console.warn(`  github ${repository}: ${(error as Error).message}`);
      data.repos[repository] = previous ?? {
        name: project.repoName,
        fullName: repository,
        description: null,
        archived: project.status === 'archived',
        homepage: null,
        topics: [],
        stargazersCount: 0,
        openIssuesCount: 0,
        defaultBranch: 'main',
        updatedAt: null,
        hasDiscussions: false,
      };
      data.releases[repository] = existing?.releases[repository] ?? [];
    }

    for (const pkg of project.packages) {
      try {
        const index = await fetchNuGetIndex(pkg.id);
        data.packages[pkg.id] = index;
        data.packageSearch[pkg.id] = await fetchNuGetSearch(pkg.id);
        nugetRefreshed += 1;
        console.log(`  nuget ${pkg.id}: ${index.versions.length} versions`);
      } catch (error) {
        const previous = existing?.packages[pkg.id];
        console.warn(`  nuget ${pkg.id}: ${(error as Error).message}`);
        data.packages[pkg.id] = previous ?? { id: pkg.id, versions: [] };
        data.packageSearch[pkg.id] = existing?.packageSearch[pkg.id] ?? null;
      }
    }
  }

  const hasPriorGitHubData = existing !== null && Object.keys(existing.repos).length > 0;
  if (githubRefreshed === 0 && hasPriorGitHubData) {
    // GitHub data could not be refreshed this run; keep the original
    // retrieval timestamp so it is never presented as fresher than it is.
    data.retrievedAt = existing!.retrievedAt;
  }
  if (githubRefreshed === 0 && !hasPriorGitHubData) {
    throw new Error(
      'Live GitHub release fetch failed for every repository and no cached GitHub data exists to fall back to.',
    );
  }
  return data;
}

if (import.meta.main) {
  const data = await fetchReleaseData();
  writeReleaseCache(data);
  console.log(
    `Wrote release cache: ${Object.keys(data.repos).length} repositories, ${Object.keys(data.packages).length} packages.`,
  );
}
