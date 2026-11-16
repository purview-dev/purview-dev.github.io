import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  countH1,
  decodeEntities,
  distFileForPath,
  extractCanonical,
  extractJsonLd,
  extractMeta,
  extractTitle,
} from '../../scripts/check-seo';

/**
 * The SEO check reads the built HTML, so its extractors are the part that must be
 * right: a check that misreads a document either passes a broken page or fails a
 * correct one.
 */

const page = `<!doctype html><html><head>
<title>Union design — Unions documentation | Purview Dev</title>
<meta name="description" content="A &amp; B description.">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://purview.dev/docs/unions/union-design/">
<script type="application/ld+json">{"@type":"TechArticle","headline":"Union design"}</script>
</head><body><h1 id="_top">Union design</h1><h1>Second</h1></body></html>`;

describe('title and canonical extraction', () => {
  test('reads the title and decodes entities', () => {
    expect(extractTitle(page)).toBe('Union design — Unions documentation | Purview Dev');
  });

  test('returns null when there is no title', () => {
    expect(extractTitle('<html><body></body></html>')).toBeNull();
  });

  test('reads the canonical href, not any other link', () => {
    expect(extractCanonical(page)).toBe('https://purview.dev/docs/unions/union-design/');
    expect(extractCanonical('<html><head></head></html>')).toBeNull();
  });
});

describe('meta extraction', () => {
  test('collects name attributes and decodes their content', () => {
    const meta = extractMeta(page, 'name');
    expect(meta.get('description')).toBe('A & B description.');
    expect(meta.get('robots')).toBe('noindex');
  });

  test('collects property attributes separately', () => {
    const html = '<meta property="og:type" content="article">';
    expect(extractMeta(html, 'property').get('og:type')).toBe('article');
    expect(extractMeta(html, 'name').size).toBe(0);
  });
});

describe('heading and structured-data extraction', () => {
  test('counts every h1', () => {
    expect(countH1(page)).toBe(2);
    expect(countH1('<h1>one</h1><h2>two</h2>')).toBe(1);
  });

  test('parses JSON-LD and marks an unparseable block as null', () => {
    expect(extractJsonLd(page)).toEqual([{ '@type': 'TechArticle', headline: 'Union design' }]);
    expect(extractJsonLd('<script type="application/ld+json">{oops</script>')).toEqual([null]);
    expect(extractJsonLd('<p>none</p>')).toEqual([]);
  });
});

describe('object attribute extraction', () => {
  test('keeps the order of the attributes in the tag', () => {
    const html = '<link data-x="1" rel="canonical" href="/a/">';
    expect(extractCanonical(html)).toBe('/a/');
  });
});

describe('dist paths', () => {
  test('maps a canonical path to its built file', () => {
    // The function returns a real filesystem path, so the expectation is built the
    // same way — asserting a literal `dist\index.html` only holds on Windows.
    expect(distFileForPath('dist', '/')).toBe(join('dist', 'index.html'));
    expect(distFileForPath('dist', '/about/')).toBe(join('dist', 'about', 'index.html'));
    expect(distFileForPath('dist', '/docs/unions/union-design/')).toBe(
      join('dist', 'docs', 'unions', 'union-design', 'index.html'),
    );
  });
});

describe('entity decoding', () => {
  test('handles the entities the site emits', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe(
      'a & b <c> "d" \'e\'',
    );
  });
});
