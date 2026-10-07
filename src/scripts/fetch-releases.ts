import type { ReleaseCacheData } from '../src/lib/releases/types';

import { loadProjects } from '../src/lib/manifest/load';
import { readReleaseCache, writeReleaseCache } from '../src/lib/releases/cache';
import {
  fetchGitHubReleases,
  fetchGitHubRepo,
  fetchNuGetIndex,
  fetchNuGetNuspec,
  fetchNuGetSearch,
} from '../src/lib/releases/github';
import { selectVersionForTargetFrameworks } from '../src/lib/releases/target-frameworks';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../src/lib/releases/types';

/**
 * Read the target frameworks a package publishes from its NuGet nuspec and
 * record them on the version index. Kept separate from the version-index fetch
 * so a nuspec failure never discards the versions themselves; a previously
 * fetched framework list is preserved on failure.
 */
async function attachTargetFrameworks(
  data: ReleaseCacheData,
  packageId: string,
  existing: ReleaseCacheData | null,
): Promise<void> {
  const index = data.packages[packageId];
  if (!index) {
    return;
  }
  const previous = existing?.packages[packageId];
  const version = selectVersionForTargetFrameworks(index.versions);
  if (!version) {
    if (previous?.targetFrameworks) {
      index.targetFrameworks = previous.targetFrameworks;
      index.targetFrameworksVersion = previous.targetFrameworksVersion ?? null;
    }
    return;
  }
  try {
    index.targetFrameworks = await fetchNuGetNuspec(packageId, version);
    index.targetFrameworksVersion = version;
    console.log(`  nuget ${packageId}: ${index.targetFrameworks.length} target framework(s)`);
  } catch (error) {
    console.warn(`  nuget ${packageId}: nuspec unavailable (${(error as Error).message})`);
    if (previous?.targetFrameworks) {
      index.targetFrameworks = previous.targetFrameworks;
      index.targetFrameworksVersion = previous.targetFrameworksVersion ?? null;
    }
  }
}

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

      await attachTargetFrameworks(data, pkg.id, existing);
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
