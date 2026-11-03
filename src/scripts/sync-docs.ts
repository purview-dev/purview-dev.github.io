import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  aggregateDocs,
  isMirrorManifestCurrent,
  readDocsManifest,
  writeDocs,
  writeDocsManifest,
} from '../src/lib/docs/aggregate';
import { loadProjects } from '../src/lib/manifest/load';
import { getReleaseIndex } from '../src/lib/releases/runtime';

/** Fetch and write the aggregated documentation mirror. */
export async function syncDocs(): Promise<{ projects: number; pages: number }> {
  const projects = loadProjects();
  const projectsWithDocs = projects.filter((project) => project.docs);
  const aggregated = await aggregateDocs(projects);
  const manifest = writeDocs(aggregated);
  writeDocsManifest(manifest);
  if (manifest.projects.length === 0 && projectsWithDocs.length > 0) {
    throw new Error(
      `Docs sync produced no pages for ${projectsWithDocs.length} project(s) with docs. ` +
        'Check GitHub API access (rate limits) and retry: run `gh auth login` or set GITHUB_TOKEN.',
    );
  }
  const pages = manifest.projects.reduce(
    (total, entry) =>
      total + entry.channels.reduce((count, channel) => count + channel.pages.length, 0),
    0,
  );
  console.log(`Docs synced: ${manifest.projects.length} projects, ${pages} pages.`);
  return { projects: manifest.projects.length, pages };
}

/** True when the generated docs mirror already exists on disk. */
export function hasDocsMirror(): boolean {
  return existsSync(resolve('src/content/docs'));
}

/**
 * True when the mirror can be reused: it exists, its manifest was written by the
 * current schema, and it was aggregated from the release data that is in hand.
 *
 * A manifest written by an older schema reads as absent (`readDocsManifest`
 * returns null), which forces a re-sync instead of building a sidebar for page
 * paths the mirror no longer has. The vintage check covers the other half: the
 * schema can be current while the release data is not, and channels are decided
 * from release data — so a mirror that predates the latest fetch documents a
 * release line that has since moved on. Reusing it publishes a stale channel
 * decision, and `check:projects` then reports the missing channel as drift.
 */
export function hasCurrentDocsMirror(): boolean {
  if (!hasDocsMirror()) {
    return false;
  }
  return isMirrorManifestCurrent(readDocsManifest(), getReleaseIndex().data.retrievedAt);
}

if (import.meta.main) {
  await syncDocs();
}
