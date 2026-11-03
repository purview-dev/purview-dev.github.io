import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getReleaseIndex, resetReleaseIndex } from '../../src/lib/releases/runtime';

/**
 * The release index is memoized for the build, so a writer that leaves the memo
 * alone makes one process read two different release datasets. That is how a
 * clean `just data-sync` aggregated the docs mirror from the committed fixtures
 * (stable `2.1.0`) while `just check-projects` read the freshly fetched cache
 * (stable `2.4.2`) and failed the prerelease channel as missing — so the memo
 * contract below is load-bearing, not an optimisation detail.
 */
describe('release index accessor', () => {
  test('memoizes the source it read first', () => {
    resetReleaseIndex();
    const first = getReleaseIndex();
    expect(getReleaseIndex()).toBe(first);
    expect(getReleaseIndex().source).toBe(first.source);
  });

  test('a reset re-reads the sources', () => {
    resetReleaseIndex();
    const first = getReleaseIndex();
    resetReleaseIndex();
    const second = getReleaseIndex();
    expect(second).not.toBe(first);
    expect(second.source).toBe(first.source);
    expect(second.data.retrievedAt).toBe(first.data.retrievedAt);
  });

  test('no script writes the release cache without refreshing the index', () => {
    // `publishReleaseData` is the only supported writer: it writes the cache and
    // updates the memo together. A bare `writeReleaseCache` call in a script is
    // the regression this test exists to prevent.
    const offenders = readdirSync(resolve('scripts'))
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /\bwriteReleaseCache\s*\(/.test(readFileSync(resolve('scripts', file), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
