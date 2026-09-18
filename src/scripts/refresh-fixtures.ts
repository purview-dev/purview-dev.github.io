import type { ReleaseCacheData } from '../src/lib/releases/types';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadProjects } from '../src/lib/manifest/load';
import {
  fetchGitHubReleasesRaw,
  fetchGitHubRepoRaw,
  fetchNuGetIndexRaw,
  fetchNuGetSearchRaw,
} from '../src/lib/releases/github';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../src/lib/releases/types';

const GITHUB_FIXTURES = resolve('fixtures', 'github');
const NUGET_FIXTURES = resolve('fixtures', 'nuget');
const RELEASE_FIXTURES = resolve('fixtures', 'releases');

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Regenerate committed test fixtures from live GitHub and NuGet data.
 * The fixtures are representative sample data with no secrets and are used by
 * the unit tests and as an offline data fallback. Run `just refresh-fixtures`
 * to update them; review the diff before committing.
 *
 * Fixture-driven unit tests derive their expectations from the fixtures
 * themselves, so no test updates are required after a refresh.
 */
async function main(): Promise<void> {
  const projects = loadProjects();
  const data: ReleaseCacheData = {
    schema: RELEASE_CACHE_SCHEMA_VERSION,
    retrievedAt: new Date().toISOString(),
    repos: {},
    releases: {},
    packages: {},
    packageSearch: {},
  };

  for (const project of projects) {
    const repository = project.repository;
    try {
      const repoRaw = await fetchGitHubRepoRaw(repository);
      writeJson(resolve(GITHUB_FIXTURES, 'repos', `${project.id}.json`), repoRaw);
      data.repos[repository] = {
        name: String(repoRaw.name ?? ''),
        fullName: String(repoRaw.full_name ?? ''),
        description: repoRaw.description == null ? null : String(repoRaw.description),
        archived: Boolean(repoRaw.archived),
        homepage: repoRaw.homepage == null ? null : String(repoRaw.homepage),
        topics: Array.isArray(repoRaw.topics) ? repoRaw.topics.map(String) : [],
        stargazersCount: Number(repoRaw.stargazers_count ?? 0),
        openIssuesCount: Number(repoRaw.open_issues_count ?? 0),
        defaultBranch: String(repoRaw.default_branch ?? 'main'),
        updatedAt: repoRaw.updated_at == null ? null : String(repoRaw.updated_at),
        hasDiscussions: Boolean(repoRaw.has_discussions),
      };
      const releasesRaw = await fetchGitHubReleasesRaw(repository);
      writeJson(resolve(GITHUB_FIXTURES, 'releases', `${project.id}.json`), releasesRaw);
      data.releases[repository] = releasesRaw.map((release) => ({
        tagName: String(release.tag_name ?? ''),
        name: release.name == null ? '' : String(release.name),
        body: release.body == null ? '' : String(release.body),
        prerelease: Boolean(release.prerelease),
        draft: Boolean(release.draft),
        publishedAt: release.published_at == null ? null : String(release.published_at),
        htmlUrl: String(release.html_url ?? ''),
      }));
      console.log(`  github ${repository}: ${releasesRaw.length} releases`);
    } catch (error) {
      console.warn(`  github ${repository}: ${(error as Error).message}`);
    }

    for (const pkg of project.packages) {
      try {
        const indexRaw = await fetchNuGetIndexRaw(pkg.id);
        writeJson(resolve(NUGET_FIXTURES, `${pkg.id.toLowerCase()}.json`), indexRaw);
        data.packages[pkg.id] = {
          id: pkg.id,
          versions: Array.isArray(indexRaw.versions) ? indexRaw.versions.map(String) : [],
        };
        const searchRaw = await fetchNuGetSearchRaw(pkg.id);
        writeJson(resolve(NUGET_FIXTURES, 'search', `${pkg.id}.json`), searchRaw);
        const dataList = Array.isArray(searchRaw.data) ? searchRaw.data : [];
        const first = dataList[0] as Record<string, unknown> | undefined;
        data.packageSearch[pkg.id] = first ? parseSearchEntry(first, pkg.id) : null;
        console.log(`  nuget ${pkg.id}: ${data.packages[pkg.id]?.versions.length ?? 0} versions`);
      } catch (error) {
        console.warn(`  nuget ${pkg.id}: ${(error as Error).message}`);
        data.packages[pkg.id] = { id: pkg.id, versions: [] };
        data.packageSearch[pkg.id] = null;
      }
    }
  }

  writeJson(resolve(RELEASE_FIXTURES, 'index.json'), data);
  console.log('Wrote release fixtures.');
}

function parseSearchEntry(
  raw: Record<string, unknown>,
  expectedId: string,
): ReleaseCacheData['packageSearch'][string] {
  if (String(raw.id ?? '').toLowerCase() !== expectedId.toLowerCase()) {
    return null;
  }
  return {
    id: String(raw.id),
    version: raw.version == null ? '' : String(raw.version),
    description: raw.description == null ? null : String(raw.description),
    totalDownloads: Number(raw.totalDownloads ?? 0),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    published: raw.published == null ? null : String(raw.published),
    deprecated: Boolean(raw.deprecated),
    listed: raw.listed === undefined ? true : Boolean(raw.listed),
  };
}

if (import.meta.main) {
  await main();
}
