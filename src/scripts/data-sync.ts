import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readManifestCache, readManifestFixture } from '../src/lib/manifest/remote';
import { readReleaseCache, readReleaseFixture } from '../src/lib/releases/cache';
import { publishReleaseData } from '../src/lib/releases/runtime';
import { fetchReleaseData } from './fetch-releases';
import { processBranding } from './process-branding';
import { syncAssets } from './sync-assets';
import { hasCurrentDocsMirror, hasDocsMirror, syncDocs } from './sync-docs';
import { syncManifests } from './sync-manifests';
import { syncSkills } from './sync-skills';

const RELEASES_CACHE_FILE = resolve('.cache/releases/releases.json');

type Mode = 'auto' | 'live' | 'cache' | 'fixture';

function resolveMode(): Mode {
  const value = (process.env.DATA_MODE ?? 'auto').toLowerCase();
  if (value === 'live' || value === 'cache' || value === 'fixture') {
    return value;
  }
  return 'auto';
}

async function syncReleases(mode: Mode): Promise<void> {
  if (mode === 'fixture') {
    if (!readReleaseFixture('index')) {
      throw new Error(
        'DATA_MODE=fixture but no release fixture exists at fixtures/releases/index.json',
      );
    }
    console.log('Releases: using committed fixtures.');
    return;
  }
  if (mode === 'cache') {
    if (!readReleaseCache()) {
      throw new Error(
        'DATA_MODE=cache but no release cache exists. Run `just fetch-releases` first.',
      );
    }
    console.log('Releases: using existing cache.');
    return;
  }
  if (mode === 'live') {
    // `publishReleaseData` also refreshes the memoized index: the fetch resolved
    // the repository/package list through `loadProjects`, which snapshots it.
    publishReleaseData(await fetchReleaseData());
    console.log('Releases: fetched live data.');
    return;
  }
  // auto: cache-first, then live, then committed fixtures.
  if (readReleaseCache()) {
    console.log('Releases: using existing cache.');
    return;
  }
  try {
    publishReleaseData(await fetchReleaseData());
    console.log('Releases: fetched live data.');
    return;
  } catch (error) {
    console.warn(`Releases: live fetch failed (${(error as Error).message}).`);
  }
  if (process.env.DATA_FALLBACK_TO_FIXTURES !== 'false' && readReleaseFixture('index')) {
    console.warn('Releases: falling back to committed fixtures.');
    return;
  }
  throw new Error(
    'No release data available: cache is missing, live fetch failed, and no fixtures are present. Run `just fetch-releases` and retry.',
  );
}

/**
 * Prepare the project-owned catalogue records (ADR 0013) before anything reads
 * the catalogue: releases, documentation, skills and assets all iterate the
 * projects, so a record that is not in hand yet is a project that is missing.
 *
 * The modes mirror the release data exactly: `fixture` and `cache` never touch
 * the network, `live` always fetches, and `auto` prefers the cache and only
 * fetches when there is none.
 */
async function syncManifestRecords(mode: Mode): Promise<void> {
  if (mode === 'fixture') {
    if (!readManifestFixture('index')) {
      throw new Error(
        'DATA_MODE=fixture but no manifest fixture exists at fixtures/manifests/index.json',
      );
    }
    console.log('Manifests: using committed fixtures.');
    return;
  }
  if (mode === 'cache') {
    if (!readManifestCache()) {
      throw new Error(
        'DATA_MODE=cache but no manifest cache exists. Run `just data-sync` (live) first.',
      );
    }
    console.log('Manifests: using existing cache.');
    return;
  }
  if (mode === 'live') {
    await syncManifests();
    return;
  }
  // auto: cache-first, then live, then committed fixtures.
  if (readManifestCache()) {
    console.log('Manifests: using existing cache.');
    return;
  }
  try {
    await syncManifests();
    return;
  } catch (error) {
    console.warn(`Manifests: live fetch failed (${(error as Error).message}).`);
  }
  if (readManifestFixture('index')) {
    console.warn('Manifests: falling back to committed fixtures.');
    return;
  }
  throw new Error(
    'No project-owned catalogue records available: the cache is missing, the live fetch failed, ' +
      'and no fixtures are present. Check GitHub access and retry.',
  );
}

async function syncDocsMirror(mode: Mode): Promise<void> {
  const current = hasCurrentDocsMirror();
  if (mode === 'cache' || mode === 'fixture') {
    if (current) {
      console.log('Docs: using existing mirror.');
      return;
    }
    if (hasDocsMirror()) {
      throw new Error(
        'Docs: the mirror at src/content/docs was written by an older docs manifest schema. ' +
          'Run `just data-sync` (live) once to regenerate it.',
      );
    }
    if (mode === 'cache') {
      throw new Error(
        'DATA_MODE=cache but no docs mirror exists at src/content/docs/docs. Run `just data-sync` with live mode first.',
      );
    }
  }
  if (current && mode === 'auto') {
    console.log('Docs: using existing mirror.');
    return;
  }
  await syncDocs();
}

/** Orchestrate all build-time data preparation (branding, releases, docs). */
export async function dataSync(): Promise<void> {
  const mode = resolveMode();
  console.log(`Data sync (mode=${mode})`);
  await processBranding();
  // Project-owned catalogue records come first: every later step iterates the
  // catalogue, so it has to be complete before releases are fetched.
  await syncManifestRecords(mode);
  // Releases are fetched next so the docs aggregation can enrich content with
  // repository descriptions and topics (tags) from the release cache.
  await syncReleases(mode);
  await syncDocsMirror(mode);
  await syncAssets(mode);
  await syncSkills(mode);
  if (!existsSync(RELEASES_CACHE_FILE) && !readReleaseFixture('index')) {
    console.warn(
      'Note: release data is unavailable. The releases page will be empty until `just fetch-releases` runs.',
    );
  }
}

if (import.meta.main) {
  await dataSync();
}
