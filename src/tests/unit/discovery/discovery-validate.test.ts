import { describe, expect, test } from 'bun:test';

import { validateIndexNowKeyFile } from '../../../scripts/discovery/validate';

/** A reader over an in-memory file map, matching the `readDist` shape. */
function fileAt(files: Record<string, string>): (path: string) => string | null {
  return (path) => files[path] ?? null;
}

/**
 * The IndexNow key verification file is written by the deploy workflow *after*
 * the build (the build never sees the key), so the build pipeline must not
 * require it. Only the deploy pipeline opts in with `require: true`.
 */
describe('IndexNow key file validation', () => {
  const KEY = 'abc12345key';

  test('does nothing when no key is configured', () => {
    expect(validateIndexNowKeyFile(fileAt({}), undefined)).toEqual([]);
    expect(validateIndexNowKeyFile(fileAt({}), '')).toEqual([]);
    expect(validateIndexNowKeyFile(fileAt({}), '   ')).toEqual([]);
  });

  test('does nothing when the key is not a valid IndexNow key', () => {
    expect(validateIndexNowKeyFile(fileAt({}), 'short')).toEqual([]);
    expect(validateIndexNowKeyFile(fileAt({}), 'bad.key')).toEqual([]);
  });

  test('accepts a present file that contains the key', () => {
    expect(validateIndexNowKeyFile(fileAt({ [`/${KEY}.txt`]: `${KEY}\n` }), KEY)).toEqual([]);
  });

  test('rejects a present file that does not contain the key', () => {
    const errors = validateIndexNowKeyFile(fileAt({ [`/${KEY}.txt`]: 'something-else' }), KEY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('does not contain the configured key');
  });

  test('ignores a missing file unless the key file is required', () => {
    // The build pipeline: the build never writes the file, so a configured key
    // must not fail validation.
    expect(validateIndexNowKeyFile(fileAt({}), KEY)).toEqual([]);
    expect(validateIndexNowKeyFile(fileAt({}), KEY, { require: false })).toEqual([]);
  });

  test('requires the file when the deploy pipeline opts in', () => {
    const errors = validateIndexNowKeyFile(fileAt({}), KEY, { require: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('key verification file is missing');
  });
});
