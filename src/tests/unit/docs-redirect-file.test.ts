import { describe, expect, test } from 'bun:test';

import { redirectFileWarnings } from '../../src/lib/docs/aggregate';
import { parseRedirectFile } from '../../src/lib/docs/redirect-file';
import { docsPageRedirects } from '../../src/lib/docs/redirects';
import { loadProjects } from '../../src/lib/manifest/load';

describe('repository redirects file', () => {
  test('reads `redirects:` pairs as slugs', () => {
    expect(
      parseRedirectFile(
        [
          '# previous: current',
          'redirects:',
          '  getting-started: guide/getting-started',
          '  Custom-Rules.md: schemas/Custom-Rules.md',
        ].join('\n'),
      ),
    ).toEqual({
      redirects: {
        'getting-started': 'guide/getting-started',
        'custom-rules': 'schemas/custom-rules',
      },
      errors: [],
    });
  });

  test('accepts a bare map and an empty file', () => {
    expect(parseRedirectFile('old: new').redirects).toEqual({ old: 'new' });
    expect(parseRedirectFile('# nothing moved yet\n')).toEqual({ redirects: {}, errors: [] });
  });

  test('rejects pairs that cannot be published', () => {
    expect(parseRedirectFile('redirects:\n  - a\n  - b').errors).toHaveLength(1);
    expect(parseRedirectFile('old:\n').errors[0]).toContain('must map');
    expect(parseRedirectFile('same: same.md').errors[0]).toContain('itself');
    expect(parseRedirectFile('old: [unclosed').errors[0]).toContain('not valid YAML');
  });

  test('warns about a destination that is not a page and a source that still is', () => {
    const pages = new Set(['index', 'guide/getting-started', 'still-here']);
    expect(
      redirectFileWarnings(
        { 'getting-started': 'guide/getting-started', gone: 'missing', 'still-here': 'index' },
        pages,
      ),
    ).toEqual([
      '_redirects.yml: "gone" points at "missing", which is not a page.',
      '_redirects.yml: "still-here" is still a page, so its redirect is not written.',
    ]);
  });
});

describe('redirects from a repository file', () => {
  const project = loadProjects().find((candidate) => candidate.id === 'unions');
  if (!project) {
    throw new Error('the unions project is expected in the catalogue');
  }

  test('forwards each channel from its own base, and the landing page to the base itself', () => {
    const redirects = docsPageRedirects([project], {
      schema: 3,
      syncedAt: '',
      releaseRetrievedAt: '',
      projects: [
        {
          projectId: 'unions',
          channels: [
            {
              id: 'live',
              ref: 'main',
              refKind: 'branch',
              version: null,
              label: 'main',
              default: true,
              pages: [],
              redirects: { 'getting-started': 'guide/getting-started', home: 'index' },
            },
            {
              id: 'prerelease',
              ref: 'main',
              refKind: 'branch',
              version: null,
              label: 'main',
              default: false,
              pages: [],
              redirects: { performance: 'guide/performance' },
            },
          ],
        },
      ],
    });
    expect(redirects.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '/docs/unions/getting-started/', to: '/docs/unions/guide/getting-started/' },
      { from: '/docs/unions/home/', to: '/docs/unions/' },
      {
        from: '/docs/unions/prerelease/performance/',
        to: '/docs/unions/prerelease/guide/performance/',
      },
    ]);
  });
});
