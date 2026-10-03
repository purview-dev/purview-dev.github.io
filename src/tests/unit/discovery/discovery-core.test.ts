import type { DiscoverableResource } from '../../../src/lib/discovery/types';

import { describe, expect, test } from 'bun:test';

import { latestTimestamp, parseGitLogDates } from '../../../src/lib/discovery/last-modified';
import { renderSitemapIndex, renderUrlset } from '../../../src/lib/discovery/sitemap';
import {
  canonical,
  isCanonicalUrl,
  projectLlmsFullUrl,
  projectLlmsUrl,
  projectPageUrl,
  sitemapIndexUrl,
} from '../../../src/lib/discovery/urls';

function resource(
  url: string,
  lastModified?: string,
  kind: DiscoverableResource['kind'] = 'page',
): DiscoverableResource {
  return { url, kind, lastModified, indexable: true };
}

describe('discovery canonical URLs', () => {
  test('builds canonical production URLs', () => {
    expect(canonical('/')).toBe('https://purview.dev/');
    expect(projectPageUrl('zodsharp')).toBe('https://purview.dev/projects/zodsharp/');
    expect(projectLlmsUrl('zodsharp')).toBe('https://purview.dev/projects/zodsharp/llms.txt');
    expect(projectLlmsFullUrl('zodsharp')).toBe(
      'https://purview.dev/projects/zodsharp/llms-full.txt',
    );
    expect(sitemapIndexUrl()).toBe('https://purview.dev/sitemap-index.xml');
  });

  test('isCanonicalUrl only accepts the configured origin', () => {
    expect(isCanonicalUrl('https://purview.dev/about/')).toBe(true);
    expect(isCanonicalUrl('https://example.com/about/')).toBe(false);
    expect(isCanonicalUrl('https://purview.dev.evil.com/')).toBe(false);
  });
});

describe('sitemap generation', () => {
  test('renders a urlset with loc and lastmod', () => {
    const xml = renderUrlset([
      resource('https://purview.dev/about/', '2025-01-02T03:04:05Z'),
      resource('https://purview.dev/projects/', undefined),
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(
      '<loc>https://purview.dev/about/</loc><lastmod>2025-01-02T03:04:05Z</lastmod>',
    );
    // No lastmod when provenance is unknown — never the build time.
    expect(xml).toContain('<url><loc>https://purview.dev/projects/</loc></url>');
  });

  test('renders a sitemap index', () => {
    const xml = renderSitemapIndex([
      { loc: 'https://purview.dev/sitemaps/pages.xml', lastmod: '2025-01-02' },
      { loc: 'https://purview.dev/sitemaps/llms.xml' },
    ]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(
      '<loc>https://purview.dev/sitemaps/pages.xml</loc><lastmod>2025-01-02</lastmod>',
    );
    expect(xml).toContain('<sitemap><loc>https://purview.dev/sitemaps/llms.xml</loc></sitemap>');
  });

  test('escapes XML-significant characters', () => {
    const xml = renderUrlset([resource('https://purview.dev/?a=1&b=2')]);
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('?a=1&b=2');
  });
});

describe('last-modified parsing', () => {
  test('indexes each file by its most recent commit', () => {
    const output = [
      '2026-10-03T11:18:47+01:00',
      'src/src/pages/about.astro',
      'src/src/pages/index.astro',
      '',
      '2026-09-01T00:00:00Z',
      'src/src/pages/about.astro',
    ].join('\n');
    const index = parseGitLogDates(output);
    expect(index.get('src/src/pages/about.astro')).toBe('2026-10-03T11:18:47+01:00');
    expect(index.get('src/src/pages/index.astro')).toBe('2026-10-03T11:18:47+01:00');
  });

  test('latestTimestamp picks the newest parseable value', () => {
    expect(latestTimestamp(['2025-01-01', null, undefined, '2025-06-01'])).toBe('2025-06-01');
    expect(latestTimestamp([null, undefined])).toBeUndefined();
  });
});
