import type { ResolvedProject } from '../src/lib/manifest/load';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { fetchRawFile } from '../src/lib/docs/aggregate';
import { loadProjects } from '../src/lib/manifest/load';

/**
 * Mirror the repository files declared in a project's `assets` into `public/`,
 * so a stable purview.dev URL can serve an artefact that lives in a product
 * repository (for example a JSON Schema). Assets are read from the repository's
 * `main` branch with the docs aggregator's `fetchRawFile`, cached under
 * `.cache/assets/`, and backed by committed fixtures under `fixtures/assets/`
 * for the offline `fixture` mode.
 */

export const ASSETS_CACHE_DIR = resolve('.cache/assets');
export const ASSETS_FIXTURE_DIR = resolve('fixtures/assets');
export const ASSETS_PUBLIC_DIR = resolve('public');

export type DataMode = 'auto' | 'live' | 'cache' | 'fixture';

export interface DeclaredAsset {
  projectId: string;
  repository: string;
  path: string;
  output: string;
  description?: string;
}

/** Flatten the assets declared across the catalogue, in project order. */
export function collectAssets(projects: ResolvedProject[]): DeclaredAsset[] {
  return projects.flatMap((project) =>
    project.assets.map((asset) => ({
      projectId: project.id,
      repository: project.repository,
      path: asset.path,
      output: asset.output,
      description: asset.description,
    })),
  );
}

function cachePath(asset: DeclaredAsset): string {
  return resolve(ASSETS_CACHE_DIR, asset.projectId, asset.path);
}

function fixturePath(asset: DeclaredAsset): string {
  return resolve(ASSETS_FIXTURE_DIR, asset.projectId, asset.path);
}

function publicPath(asset: DeclaredAsset): string {
  return resolve(ASSETS_PUBLIC_DIR, asset.output);
}

function writeFile(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

async function fetchAsset(asset: DeclaredAsset): Promise<string> {
  const raw = await fetchRawFile(asset.repository, 'main', asset.path);
  if (!raw) {
    throw new Error(
      `Declared asset not found: ${asset.repository}/${asset.path} (project "${asset.projectId}"). ` +
        "Publish the file on the repository's main branch or correct the manifest.",
    );
  }
  return raw.content;
}

/** Resolve one asset's content for the requested data mode. */
async function resolveAsset(
  asset: DeclaredAsset,
  mode: DataMode,
): Promise<{ content: string; source: 'live' | 'cache' | 'fixture' }> {
  const cache = cachePath(asset);
  const fixture = fixturePath(asset);

  if (mode === 'fixture') {
    if (!existsSync(fixture)) {
      throw new Error(
        `DATA_MODE=fixture but the declared asset has no fixture: ${asset.projectId}/${asset.path} (${fixture}).`,
      );
    }
    return { content: readFileSync(fixture, 'utf8'), source: 'fixture' };
  }
  if (mode === 'cache') {
    if (!existsSync(cache)) {
      throw new Error(
        `DATA_MODE=cache but the declared asset has no cached copy: ${asset.projectId}/${asset.path}. ` +
          'Run `just live-data-sync` (or `just fetch-releases`) first.',
      );
    }
    return { content: readFileSync(cache, 'utf8'), source: 'cache' };
  }
  if (mode === 'live') {
    return { content: await fetchAsset(asset), source: 'live' };
  }
  // auto: cache-first, then live, then the committed fixture.
  if (existsSync(cache)) {
    return { content: readFileSync(cache, 'utf8'), source: 'cache' };
  }
  try {
    return { content: await fetchAsset(asset), source: 'live' };
  } catch (error) {
    if (existsSync(fixture)) {
      console.warn(
        `  assets ${asset.output}: live fetch failed (${(error as Error).message}); using fixture.`,
      );
      return { content: readFileSync(fixture, 'utf8'), source: 'fixture' };
    }
    throw error;
  }
}

/**
 * Mirror every declared asset into `public/`, caching a live fetch for offline
 * reuse. Throws when a declared asset cannot be resolved, so a missing asset
 * fails the data sync rather than silently shipping a broken URL.
 */
export async function syncAssets(mode: DataMode): Promise<number> {
  const assets = collectAssets(loadProjects());
  if (assets.length === 0) {
    console.log('Assets: none declared.');
    return 0;
  }
  for (const asset of assets) {
    const { content, source } = await resolveAsset(asset, mode);
    if (source === 'live') {
      writeFile(cachePath(asset), content);
    }
    writeFile(publicPath(asset), content);
    console.log(`  asset ${asset.output} <- ${asset.repository}/${asset.path} (${source})`);
  }
  console.log(`Assets mirrored: ${assets.length} file(s).`);
  return assets.length;
}

if (import.meta.main) {
  const requested = (process.env.DATA_MODE ?? 'auto').toLowerCase();
  const mode: DataMode = ['auto', 'live', 'cache', 'fixture'].includes(requested)
    ? (requested as DataMode)
    : 'auto';
  await syncAssets(mode);
}
