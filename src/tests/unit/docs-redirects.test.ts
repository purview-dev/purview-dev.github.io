import type { DocsManifest } from '../../src/lib/docs/aggregate';

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DOCS_MANIFEST_SCHEMA } from '../../src/lib/docs/aggregate';
import {
  renderChannelRedirect,
  retiredChannelRedirects,
  writeRetiredChannelRedirects,
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
});
