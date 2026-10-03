import { describe, expect, test } from 'bun:test';

import {
  firstMatchingPattern,
  LOCAL_PATH_PATTERNS,
  SECRET_PATTERNS,
} from '../../src/lib/build-paths';

/**
 * The scan exists to catch the build machine's own paths, not every absolute
 * path a document happens to show. These cases pin both halves: real leaks are
 * still caught, and sanctioned documentation examples are not (ADR 0006).
 */
describe('build-output safety patterns', () => {
  const leaks = [
    String.raw`C:\Users\bob\source\repo`,
    String.raw`C:\Users\runneradmin\AppData\Local\Temp\build`,
    String.raw`D:\a\purview-dev\purview-dev\src\dist`,
    String.raw`C:\actions-runner\_work\purview-dev\purview-dev`,
    String.raw`C:\hostedtoolcache\windows\dotnet\10.0.0`,
    '/Users/bob/source/repo',
    '/home/runner/work/purview-dev/purview-dev',
    'src/.cache/docs/index.json',
    'node_modules/astro/package.json',
  ];

  const documentation = [
    String.raw`D:\wslc-images`,
    String.raw`StoragePath = @"D:\wslc-images",`,
    String.raw`%LOCALAPPDATA%\Purview\WslContainers\images`,
    '/mnt/d/wslc-images',
  ];

  test('flags build-machine paths', () => {
    for (const value of leaks) {
      expect(firstMatchingPattern(LOCAL_PATH_PATTERNS, value), value).not.toBeNull();
    }
  });

  test('allows documentation drive-letter examples', () => {
    for (const value of documentation) {
      expect(firstMatchingPattern(LOCAL_PATH_PATTERNS, value), value).toBeNull();
    }
  });

  test('still matches credential patterns', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    expect(firstMatchingPattern(SECRET_PATTERNS, token)).not.toBeNull();
    expect(firstMatchingPattern(SECRET_PATTERNS, 'plain documentation text')).toBeNull();
  });
});
