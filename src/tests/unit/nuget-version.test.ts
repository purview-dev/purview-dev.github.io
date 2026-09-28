import { describe, expect, test } from 'bun:test';

import {
  compareNuGetVersions,
  formatNuGetVersion,
  isPrereleaseNuGetVersion,
  isValidNuGetVersion,
  parseNuGetVersion,
  stripVersionPrefix,
} from '../../src/lib/nuget-version';

describe('parseNuGetVersion', () => {
  test('parses a three-component version with an implicit zero revision', () => {
    const parsed = parseNuGetVersion('13.5.3');
    expect(parsed?.core).toEqual([13, 5, 3, 0]);
    expect(parsed?.prerelease).toEqual([]);
    expect(parsed?.buildMetadata).toBeNull();
  });

  test('keeps the fourth (build revision) component NuGet allows', () => {
    // semver rejects four-component versions; NuGet treats them as normal
    // releases, so dropping them reported a stale "latest" version.
    const parsed = parseNuGetVersion('13.5.3.6');
    expect(parsed?.core).toEqual([13, 5, 3, 6]);
    expect(parsed?.prerelease).toEqual([]);
    expect(isValidNuGetVersion('13.5.3.6')).toBe(true);
  });

  test('parses a prerelease label on a four-component version', () => {
    const parsed = parseNuGetVersion('13.5.3.2-prerelease.1');
    expect(parsed?.core).toEqual([13, 5, 3, 2]);
    expect(parsed?.prerelease).toEqual(['prerelease', '1']);
  });

  test('parses build metadata without folding it into the version', () => {
    const parsed = parseNuGetVersion('1.2.3+build.5');
    expect(parsed?.core).toEqual([1, 2, 3, 0]);
    expect(parsed?.buildMetadata).toBe('build.5');
    expect(parsed?.prerelease).toEqual([]);
  });

  test('strips a v prefix and repairs the historical reprelease typo', () => {
    expect(stripVersionPrefix('v13.5.3.2')).toBe('13.5.3.2');
    expect(parseNuGetVersion('v13.5.3.2-prerelease.1')?.core).toEqual([13, 5, 3, 2]);
    expect(parseNuGetVersion('1.0.0-reprelease.0')?.prerelease).toEqual(['prerelease', '0']);
  });

  test('rejects values that are not versions', () => {
    expect(parseNuGetVersion('nightly')).toBeNull();
    expect(parseNuGetVersion('')).toBeNull();
    expect(isValidNuGetVersion('not-a-version')).toBe(false);
  });
});

describe('compareNuGetVersions', () => {
  test('ranks a build revision above the base version', () => {
    expect(compareNuGetVersions('13.5.3.6', '13.5.3')).toBe(1);
    expect(compareNuGetVersions('13.5.3', '13.5.3.6')).toBe(-1);
  });

  test('compares revisions numerically, not as strings', () => {
    expect(compareNuGetVersions('13.5.3.10', '13.5.3.9')).toBe(1);
  });

  test('treats an omitted revision as zero', () => {
    expect(compareNuGetVersions('13.5.3', '13.5.3.0')).toBe(0);
  });

  test('ranks prereleases below the matching stable version', () => {
    expect(compareNuGetVersions('2.0.0-prerelease.38', '2.0.0')).toBe(-1);
    expect(compareNuGetVersions('2.0.0-prerelease.38', '2.0.0-prerelease.9')).toBe(1);
    expect(compareNuGetVersions('13.3.0-prerelease.10', '13.5.3.6')).toBe(-1);
  });

  test('falls back to a string comparison for unparseable values', () => {
    expect(compareNuGetVersions('nightly', 'nightly')).toBe(0);
    expect(compareNuGetVersions('alpha', 'beta')).toBeLessThan(0);
  });
});

describe('isPrereleaseNuGetVersion', () => {
  test('classifies by the label, not by the number of components', () => {
    expect(isPrereleaseNuGetVersion('13.5.3.2-prerelease.1')).toBe(true);
    expect(isPrereleaseNuGetVersion('13.5.3.2')).toBe(false);
    expect(isPrereleaseNuGetVersion('13.5.3')).toBe(false);
    expect(isPrereleaseNuGetVersion('nightly')).toBe(false);
  });
});

describe('formatNuGetVersion', () => {
  test('keeps a non-zero build revision', () => {
    expect(formatNuGetVersion('13.5.3.6')).toBe('13.5.3.6');
    expect(formatNuGetVersion('13.5.3.2-prerelease.1')).toBe('13.5.3.2-prerelease.1');
  });

  test('drops a zero revision, which NuGet treats as the same version', () => {
    expect(formatNuGetVersion('13.5.3.0')).toBe('13.5.3');
    expect(formatNuGetVersion('13.5.3')).toBe('13.5.3');
  });

  test('preserves prerelease labels and build metadata', () => {
    expect(formatNuGetVersion('2.0.0-prerelease.38')).toBe('2.0.0-prerelease.38');
    expect(formatNuGetVersion('1.2.3+build.5')).toBe('1.2.3+build.5');
  });

  test('leaves unparseable values untouched apart from the prefix', () => {
    expect(formatNuGetVersion('nightly')).toBe('nightly');
    expect(formatNuGetVersion('vnightly')).toBe('nightly');
  });
});
