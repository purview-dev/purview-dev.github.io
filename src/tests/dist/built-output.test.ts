import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve('dist');

function requireBuilt(file: string): string {
  const path = resolve(DIST, file);
  if (!existsSync(path)) {
    throw new Error(`Required build output missing: ${file}. Run \`just build\` first.`);
  }
  return readFileSync(path, 'utf8');
}

describe('built llms outputs', () => {
  test('all three llms files exist', () => {
    expect(existsSync(resolve(DIST, 'llms.txt'))).toBe(true);
    expect(existsSync(resolve(DIST, 'llms-small.txt'))).toBe(true);
    expect(existsSync(resolve(DIST, 'llms-full.txt'))).toBe(true);
  });

  test('llms.txt uses canonical production URLs', () => {
    const content = requireBuilt('llms.txt');
    expect(content).toContain('https://purview.dev/llms-small.txt');
    expect(content).toContain('https://purview.dev/llms-full.txt');
    expect(content).toContain('https://github.com/purview-dev');
  });

  test('llms-full.txt includes aggregated documentation content', () => {
    const content = requireBuilt('llms-full.txt');
    expect(content.trim().length).toBeGreaterThan(10_000);
    expect(content).toContain('Purview');
  });

  test('llms outputs exclude secrets and local build paths', () => {
    const content = [
      requireBuilt('llms.txt'),
      requireBuilt('llms-small.txt'),
      requireBuilt('llms-full.txt'),
    ].join('\n');
    expect(content).not.toMatch(/\bghp_[A-Za-z0-9]{36,}\b/);
    expect(content).not.toMatch(/\.cache[/\\]/);
    expect(content).not.toMatch(/[A-Za-z]:\\/);
    expect(content).not.toMatch(/node_modules/);
  });
});

describe('built SEO outputs', () => {
  test('sitemap index exists and references the canonical site', () => {
    const content = requireBuilt('sitemap-index.xml');
    expect(content).toContain('https://purview.dev/sitemap-0.xml');
  });

  test('robots.txt references the sitemap', () => {
    const content = requireBuilt('robots.txt');
    expect(content).toContain('https://purview.dev/sitemap-index.xml');
  });

  test('key brand assets are present in the build', () => {
    for (const file of [
      'favicon.svg',
      'favicon-32.png',
      'apple-touch-icon.png',
      'og/default.png',
      'site.webmanifest',
    ]) {
      expect(existsSync(resolve(DIST, file)), `missing ${file}`).toBe(true);
    }
  });
});

describe('built HTML safety', () => {
  test('no local paths or secrets leak into generated pages', () => {
    const { glob } = require('fast-glob');
    const files = glob.sync('**/*.html', { cwd: DIST });
    for (const file of files) {
      const content = readFileSync(resolve(DIST, file), 'utf8');
      expect(content).not.toMatch(/[A-Za-z]:\\/);
      expect(content).not.toMatch(/\bghp_[A-Za-z0-9]{36,}\b/);
    }
  });
});

describe('built footer version', () => {
  test('homepage footer shows the workspace root version', () => {
    const manifest = JSON.parse(readFileSync(resolve('..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    const version = manifest.version;
    expect(version).toBeTruthy();

    const content = requireBuilt('index.html');
    expect(content).toContain(`>v${version}<`);
    expect(content).toContain('https://github.com/purview-dev/purview-dev.github.io/releases');
  });
});
