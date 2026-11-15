import type { ManifestCacheData } from '../src/lib/manifest/remote';

import {
  MANIFEST_CACHE_SCHEMA_VERSION,
  PROJECT_MANIFEST_PATH,
  fetchProjectManifests,
  listOrganizationRepositories,
  readManifestCache,
} from '../src/lib/manifest/remote';
import { publishManifestData } from '../src/lib/manifest/runtime';

/**
 * Fetch every project-owned catalogue record (ADR 0013).
 *
 * The organisation's repository list is the discovery root: a repository that
 * publishes `.config/purview-docs.yml` is a catalogue project. This is why the
 * sync runs *first* in `just data-sync` — releases, documentation, skills and
 * assets all iterate the catalogue, so the records have to be in hand before
 * anything reads it.
 *
 * A repository that cannot be read fails the sync rather than being skipped: the
 * site would otherwise silently publish a catalogue that is missing a project.
 */
export async function syncManifests(): Promise<ManifestCacheData> {
  const previous = readManifestCache();
  const repositories = await listOrganizationRepositories();
  const manifests = await fetchProjectManifests(repositories);

  // A repository that stopped publishing its record is a project leaving the
  // catalogue. Say so here, where it can be explained: the catalogue's own
  // invariants otherwise report it as an unknown id in some *other* project's
  // relationships, which names the symptom rather than the cause.
  const fetched = new Set(manifests.map((manifest) => manifest.repository));
  for (const manifest of previous?.manifests ?? []) {
    if (!fetched.has(manifest.repository)) {
      console.warn(
        `Manifests: ${manifest.repository} no longer publishes ${PROJECT_MANIFEST_PATH}; ` +
          'its project has left the catalogue.',
      );
    }
  }

  const data: ManifestCacheData = {
    schema: MANIFEST_CACHE_SCHEMA_VERSION,
    retrievedAt: new Date().toISOString(),
    manifests,
  };
  publishManifestData(data);
  console.log(
    `Manifests synced: ${manifests.length} project-owned record(s) from ${repositories.length} ` +
      `repositor${repositories.length === 1 ? 'y' : 'ies'}` +
      `${manifests.length > 0 ? ` (${manifests.map((item) => item.repository).join(', ')})` : ''}.`,
  );
  return data;
}

if (import.meta.main) {
  await syncManifests();
}

if (import.meta.main) {
  await syncManifests();
}
