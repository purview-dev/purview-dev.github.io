import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { aggregateDocs, writeDocs, writeDocsManifest } from '../src/lib/docs/aggregate';
import { loadProjects } from '../src/lib/manifest/load';

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
  const pages = manifest.projects.reduce((total, entry) => total + entry.pages.length, 0);
  console.log(`Docs synced: ${manifest.projects.length} projects, ${pages} pages.`);
  return { projects: manifest.projects.length, pages };
}

/** True when the generated docs mirror already exists on disk. */
export function hasDocsMirror(): boolean {
  return existsSync(resolve('src/content/docs'));
}

if (import.meta.main) {
  await syncDocs();
}
