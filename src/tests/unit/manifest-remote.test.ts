import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MANIFEST_CACHE_SCHEMA_VERSION,
  PROJECT_MANIFEST_PATH,
  isManifestCache,
  readManifestCache,
  writeManifestCache,
} from '../../src/lib/manifest/remote';

/**
 * Project-owned catalogue records (ADR 0013) are fetched from the repositories
 * that own them, so what decides whether a build sees the catalogue at all is the
 * cache: a schema bump must read as "absent" (and force a sync) rather than as an
 * empty catalogue, which would publish a site with no projects on it.
 */
function makeCache(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema: MANIFEST_CACHE_SCHEMA_VERSION,
    retrievedAt: '2026-11-15T00:00:00.000Z',
    manifests: [
      {
        repository: 'purview-dev/example',
        ref: 'main',
        record: { id: 'example', repository: 'purview-dev/example' },
      },
    ],
    ...overrides,
  };
}

describe('project-owned catalogue records', () => {
  test('round-trips a cache through disk', () => {
    const folder = mkdtempSync(join(tmpdir(), 'purview-manifests-'));
    try {
      const file = join(folder, 'manifests.json');
      writeManifestCache(makeCache() as Parameters<typeof writeManifestCache>[0], file);

      const read = readManifestCache(file);
      expect(read?.schema).toBe(MANIFEST_CACHE_SCHEMA_VERSION);
      expect(read?.manifests[0]?.repository).toBe('purview-dev/example');
      expect(read?.manifests[0]?.record.id).toBe('example');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('reads a cache written by an older schema as absent', () => {
    const folder = mkdtempSync(join(tmpdir(), 'purview-manifests-'));
    try {
      const file = join(folder, 'manifests.json');
      writeManifestCache(
        makeCache({ schema: MANIFEST_CACHE_SCHEMA_VERSION - 1 }) as Parameters<
          typeof writeManifestCache
        >[0],
        file,
      );

      expect(readManifestCache(file)).toBeNull();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('rejects a record that is not an object', () => {
    expect(isManifestCache(makeCache({ manifests: [{ repository: 'a/b', ref: 'main' }] }))).toBe(
      false,
    );
    expect(isManifestCache(makeCache({ manifests: 'not-an-array' }))).toBe(false);
    expect(isManifestCache(makeCache())).toBe(true);
  });

  test('accepts a cache with no records', () => {
    expect(isManifestCache(makeCache({ manifests: [] }))).toBe(true);
  });

  test('names the file a project publishes its record in', () => {
    expect(PROJECT_MANIFEST_PATH).toBe('.config/purview-docs.yml');
  });
});
