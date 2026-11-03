import type { DocsManifest } from '../../src/lib/docs/aggregate';

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DOCS_MANIFEST_SCHEMA } from '../../src/lib/docs/aggregate';
import {
  docsPageRedirects,
  renderChannelRedirect,
  retiredChannelRedirects,
  writeDocsPageRedirects,
  writeRetiredChannelRedirects,
  writeRetiredPageRedirects,
} from '../../src/lib/docs/redirects';
import { loadProjects } from '../../src/lib/manifest/load';

const projects = loadProjects();

const PAGES = [
  {
    slug: 'index',
    title: 'ZodSharp',
    order: -1,
    sourcePath: 'docs/wiki/Getting-Started.md',
    hash: 'live-index',
  },
  {
    slug: 'core-concepts',
    title: 'Core concepts',
    order: 1,
    sourcePath: 'docs/wiki/Core-Concepts.md',
    hash: 'live-core',
  },
];

function manifestWith(channelIds: ('live' | 'prerelease')[]): DocsManifest {
  return {
    schema: DOCS_MANIFEST_SCHEMA,
    syncedAt: '2026-03-11T00:00:00.000Z',
    releaseRetrievedAt: '2026-03-11T00:00:00.000Z',
    projects: [
      {
        projectId: 'zodsharp',
        channels: channelIds.map((id) => ({
          id,
          ref: id === 'live' ? 'v2.4.2' : 'main',
          refKind: id === 'live' ? 'tag' : 'branch',
          version: id === 'live' ? '2.4.2' : null,
          label: id === 'live' ? '2.4.2' : 'main',
          default: id === 'live',
          pages: PAGES,
        })),
      },
    ],
  };
}

describe('retired documentation channel redirects', () => {
  test('a published channel owns its URLs, so nothing is redirected', () => {
    expect(retiredChannelRedirects(projects, manifestWith(['live', 'prerelease']))).toEqual([]);
  });

  test('a withheld channel sends every live page to its live equivalent', () => {
    // This is the promotion state: `docs.channels.prerelease` is still declared,
    // but the sync withheld the channel because the release caught up.
    expect(retiredChannelRedirects(projects, manifestWith(['live']))).toEqual([
      { from: '/docs/zodsharp/prerelease/', to: '/docs/zodsharp/' },
      { from: '/docs/zodsharp/prerelease/core-concepts/', to: '/docs/zodsharp/core-concepts/' },
    ]);
  });

  test('projects without channels and archived projects are left alone', () => {
    const withoutChannels = projects.map((project) =>
      project.id === 'zodsharp'
        ? { ...project, docs: { source: 'github-path' as const, path: 'docs/wiki' } }
        : project,
    );
    expect(retiredChannelRedirects(withoutChannels, manifestWith(['live']))).toEqual([]);

    const archived = projects.map((project) =>
      project.id === 'zodsharp' ? { ...project, status: 'archived' as const } : project,
    );
    expect(retiredChannelRedirects(archived, manifestWith(['live']))).toEqual([]);
  });

  test('the redirect page is a noindex meta refresh with a canonical target', () => {
    const html = renderChannelRedirect({
      from: '/docs/zodsharp/prerelease/',
      to: '/docs/zodsharp/',
    });
    expect(html).toContain('http-equiv="refresh" content="0; url=/docs/zodsharp/"');
    expect(html).toContain('<link rel="canonical" href="https://purview.dev/docs/zodsharp/"');
    expect(html).toContain('name="robots" content="noindex, follow"');
    expect(html).toContain('data-pagefind-ignore');
  });

  test('writing redirects never overwrites a real page', () => {
    const dist = mkdtempSync(join(tmpdir(), 'purview-redirects-'));
    try {
      const existing = join(dist, 'docs', 'zodsharp', 'prerelease', 'index.html');
      mkdirSync(dirname(existing), { recursive: true });
      writeFileSync(existing, 'real page', 'utf8');

      const written = writeRetiredChannelRedirects(dist, projects, manifestWith(['live']));

      expect(written).toEqual([
        join('docs', 'zodsharp', 'prerelease', 'core-concepts', 'index.html'),
      ]);
      expect(readFileSync(existing, 'utf8')).toBe('real page');
      expect(
        readFileSync(
          join(dist, 'docs', 'zodsharp', 'prerelease', 'core-concepts', 'index.html'),
          'utf8',
        ),
      ).toContain('url=/docs/zodsharp/core-concepts/');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test('a page that moved writes a redirect to its new home', () => {
    const dist = mkdtempSync(join(tmpdir(), 'purview-redirects-'));
    try {
      expect(writeRetiredPageRedirects(dist)).toEqual([join('skills', 'index.html')]);
      const html = readFileSync(join(dist, 'skills', 'index.html'), 'utf8');
      expect(html).toContain('http-equiv="refresh" content="0; url=/projects/"');
      expect(html).toContain('Agent skills are now listed on the project');
      expect(html).toContain('name="robots" content="noindex, follow"');

      // The moved page never overwrites a real page that owns the URL.
      expect(writeRetiredPageRedirects(dist)).toEqual([]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('moved documentation page redirects', () => {
  test('every nested page keeps the flat URL it had before the folders', () => {
    // ZodSharp's documentation moved into topic folders, which made each folder part of the page's URL. The
    // former flat address of every moved page is its file name alone, so the declared map must cover each one.
    const zodsharp = projects.find((project) => project.id === 'zodsharp');
    const moved = zodsharp?.docs?.source === 'github-path' ? (zodsharp.docs.redirects ?? {}) : {};
    const nested = Object.values(moved).filter((slug) => slug.includes('/'));

    expect(nested.length).toBe(Object.keys(moved).length);
    expect(moved['performance']).toBe('quality/performance');
    expect(moved['custom-rules']).toBe('schemas/custom-rules');

    for (const [from, to] of Object.entries(moved)) {
      // The former slug is the page's file name, slugified.
      expect(from).toBe(to.slice(to.lastIndexOf('/') + 1));
    }

    expect(docsPageRedirects(projects)).toContainEqual({
      from: '/docs/zodsharp/performance/',
      to: '/docs/zodsharp/quality/performance/',
      title: 'This documentation page moved…',
      message: 'The page now lives at its new address.',
    });
  });

  test('a move is forwarded on every channel that publishes the tree', () => {
    // The prerelease channel publishes the reorganised tree long before the
    // release that carries it is promoted, so its readers follow the same move:
    // every pair exists under both bases, and the write guards decide which of
    // them are real in the build at hand.
    expect(docsPageRedirects(projects)).toContainEqual({
      from: '/docs/zodsharp/prerelease/performance/',
      to: '/docs/zodsharp/prerelease/quality/performance/',
      title: 'This documentation page moved…',
      message: 'The page now lives at its new address.',
    });
  });

  test('a single-channel project forwards the canonical base only', () => {
    // Without a second declared channel there is no `/prerelease/` URL to
    // forward: the channel is the default one, and it owns `/docs/<id>/`.
    const singleChannel = projects.map((project) =>
      project.id === 'zodsharp'
        ? {
            ...project,
            docs: {
              source: 'github-path' as const,
              path: 'docs/wiki',
              redirects: { performance: 'quality/performance' },
            },
          }
        : project,
    );
    expect(
      docsPageRedirects(singleChannel)
        .filter((redirect) => redirect.from.startsWith('/docs/zodsharp/'))
        .map((redirect) => [redirect.from, redirect.to]),
    ).toEqual([['/docs/zodsharp/performance/', '/docs/zodsharp/quality/performance/']]);
  });

  test('a moved page is written as a redirect once its new address is published', () => {
    const dist = mkdtempSync(join(tmpdir(), 'purview-redirects-'));
    try {
      // The destination exists in this channel, the old slug does not: the redirect is written.
      const target = join(dist, 'docs', 'zodsharp', 'quality', 'performance', 'index.html');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'real page', 'utf8');

      const written = writeDocsPageRedirects(dist, projects);
      expect(written).toContain(join('docs', 'zodsharp', 'performance', 'index.html'));

      const html = readFileSync(
        join(dist, 'docs', 'zodsharp', 'performance', 'index.html'),
        'utf8',
      );
      expect(html).toContain('url=/docs/zodsharp/quality/performance/');
      expect(html).toContain('name="robots" content="noindex, follow"');

      // A second run writes nothing: the redirects are created once.
      expect(writeDocsPageRedirects(dist, projects)).toEqual([]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test('a moved page is left alone while its new address is unpublished', () => {
    // This is the promotion lag: the folders are in source, but the default channel still reads the release tag from
    // before the move, so `quality/performance/` is not published yet. Forwarding into a 404 - or shadowing the live
    // page at the old slug - would both be wrong, so nothing is written.
    const dist = mkdtempSync(join(tmpdir(), 'purview-redirects-'));
    try {
      const livePage = join(dist, 'docs', 'zodsharp', 'performance', 'index.html');
      mkdirSync(dirname(livePage), { recursive: true });
      writeFileSync(livePage, 'live page', 'utf8');

      expect(writeDocsPageRedirects(dist, projects)).toEqual([]);
      expect(readFileSync(livePage, 'utf8')).toBe('live page');

      // The same page, once the release that carries the folders is promoted: the old slug is gone and the new
      // address is published, so the redirect appears.
      rmSync(livePage);
      const target = join(dist, 'docs', 'zodsharp', 'quality', 'performance', 'index.html');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'real page', 'utf8');
      expect(writeDocsPageRedirects(dist, projects)).toEqual([
        join('docs', 'zodsharp', 'performance', 'index.html'),
      ]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
