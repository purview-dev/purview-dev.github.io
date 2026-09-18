import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findWorkspaceRoot, readVersion } from '../../src/lib/site-version';

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'purview-site-version-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'purview-dev', version: '0.1.0', workspaces: ['src'] }),
  );
  return root;
}

describe('findWorkspaceRoot', () => {
  test('resolves the nearest ancestor package.json with workspaces', () => {
    const root = createFixture();
    try {
      expect(findWorkspaceRoot(join(root, 'src', 'nested'))).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('throws when no workspace root exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'purview-site-version-none-'));
    try {
      expect(() => findWorkspaceRoot(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('readVersion', () => {
  test('returns the version field', () => {
    const root = createFixture();
    try {
      expect(readVersion(root)).toBe('0.1.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('throws when the version field is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'purview-site-version-none-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'purview-dev' }));
      expect(() => readVersion(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
