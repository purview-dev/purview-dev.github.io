import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isValidIndexNowKey, writeIndexNowKeyFile } from '../../../src/lib/discovery/emit';

describe('IndexNow key handling', () => {
  test('accepts only protocol-valid keys', () => {
    expect(isValidIndexNowKey('abc12345')).toBe(true);
    expect(isValidIndexNowKey('A1b2C3d4E5f6-g7h8')).toBe(true);
    expect(isValidIndexNowKey('short')).toBe(false);
    expect(isValidIndexNowKey('has space')).toBe(false);
    expect(isValidIndexNowKey('bad.symbol')).toBe(false);
    expect(isValidIndexNowKey('')).toBe(false);
  });

  test('writes the verification file from the supplied key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'purview-key-'));
    try {
      const result = writeIndexNowKeyFile(dir, 'abc12345key');
      expect(result.ok).toBe(true);
      const file = join(dir, 'abc12345key.txt');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8').trim()).toBe('abc12345key');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses a missing key, an invalid key, or a missing build output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'purview-key-'));
    try {
      for (const key of [undefined, '', '   ', 'bad key']) {
        const result = writeIndexNowKeyFile(dir, key);
        expect(result.ok, `key ${JSON.stringify(key)} must be rejected`).toBe(false);
        expect(result.file).toBeUndefined();
      }
      const missing = writeIndexNowKeyFile(join(dir, 'does-not-exist'), 'abc12345key');
      expect(missing.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
