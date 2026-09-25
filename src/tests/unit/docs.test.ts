import type { DocFrontmatter } from '../../src/lib/docs/frontmatter';
import type { DocLinkContext } from '../../src/lib/docs/links';

import { describe, expect, test } from 'bun:test';

import { DocsValidationError, isExcluded, selectDocsRootFile } from '../../src/lib/docs/aggregate';
import { convertGithubAlerts, parseGithubAlerts } from '../../src/lib/docs/alerts';
import {
  extractDescription,
  extractTitle,
  renderFrontmatter,
} from '../../src/lib/docs/frontmatter';
import {
  extractHeadingSlugs,
  resolveDocRelativeLink,
  resolveRepoPath,
  rewriteDocMarkdown,
  slugifyDocFile,
} from '../../src/lib/docs/links';

function context(overrides: Partial<DocLinkContext> = {}): DocLinkContext {
  return {
    projectId: 'demo',
    repository: 'purview-dev/demo',
    branch: 'main',
    knownSlugs: new Set(['index', 'getting-started', 'sql-server-guide', 'multi-targeting']),
    sourcePath: 'docs',
    imageBase: 'https://github.com/purview-dev/demo/raw/main/docs/',
    headingSlugs: new Map([
      ['sql-server-guide', new Set(['permissions', 'setup'])],
      ['multi-targeting', new Set(['generation'])],
    ]),
    ...overrides,
  };
}

function rawDoc(path: string) {
  return { path, content: `# ${path}`, lastModified: '2026-09-18' };
}

describe('slugifyDocFile', () => {
  test('slugifies file names and handles extensionless names', () => {
    expect(slugifyDocFile('Getting-Started.md')).toBe('getting-started');
    expect(slugifyDocFile('Multi-Targeting')).toBe('multi-targeting');
    expect(slugifyDocFile('SQL Server Guide.md')).toBe('sql-server-guide');
  });
});

describe('front matter', () => {
  const markdown = [
    '# Getting Started',
    '',
    'How to install **Purview.EventSourcing** and run your first aggregate.',
    '',
    '## Next',
    'More text.',
  ].join('\n');

  test('extracts the title from the first heading', () => {
    expect(extractTitle(markdown, 'home.md')).toBe('Getting Started');
  });

  test('extracts a clean description', () => {
    expect(extractDescription(markdown)).toBe(
      'How to install Purview.EventSourcing and run your first aggregate.',
    );
  });

  test('renders deterministic front matter with a quoted date', () => {
    const frontmatter: DocFrontmatter = {
      title: 'Getting Started',
      description: 'Intro',
      owners: ['purview-dev'],
      status: 'preview',
      lastReviewed: '2026-09-15',
      sourceProject: 'event-sourcing',
      sourceRepo: 'purview-dev/event-sourcing',
      sourcePath: 'docs/wiki/Getting-Started.md',
      editUrl:
        'https://github.com/purview-dev/event-sourcing/edit/main/docs/wiki/Getting-Started.md',
    };
    const rendered = renderFrontmatter(frontmatter);
    expect(rendered).toContain('lastReviewed: "2026-09-15"');
    expect(rendered).toContain('owners: [purview-dev]');
    expect(rendered.startsWith('---')).toBe(true);
  });

  test('renders repository tags when present', () => {
    const frontmatter: DocFrontmatter = {
      title: 'Getting Started',
      description: 'Intro',
      owners: ['purview-dev'],
      status: 'preview',
      lastReviewed: '2026-09-15',
      sourceProject: 'event-sourcing',
      sourceRepo: 'purview-dev/event-sourcing',
      sourcePath: 'docs/wiki/Getting-Started.md',
      editUrl: 'https://github.com/purview-dev/event-sourcing/edit/main/Getting-Started.md',
      tags: ['event-sourcing', 'dotnet', 'csharp'],
    };
    const rendered = renderFrontmatter(frontmatter);
    expect(rendered).toContain('tags: [event-sourcing, dotnet, csharp]');
  });
});

describe('link rewriting', () => {
  test('rewrites relative md links to known pages', () => {
    const output = rewriteDocMarkdown('[Install](Getting-Started.md)', context());
    expect(output).toBe('[Install](<doclink:getting-started>)');
  });

  test('rewrites links whose label contains brackets (code spans)', () => {
    const output = rewriteDocMarkdown(
      'See [`[Tag]`](Tags-and-Baggage.md).',
      context({ knownSlugs: new Set(['index', 'tags-and-baggage']) }),
    );
    expect(output).toBe('See [`[Tag]`](<doclink:tags-and-baggage>).');
  });

  test('rewrites links whose label spans multiple lines', () => {
    const output = rewriteDocMarkdown(
      'See [Source\nGenerator Behaviors](Source-Generator-Behaviors.md).',
      context({ knownSlugs: new Set(['index', 'source-generator-behaviors']) }),
    );
    expect(output).toBe('See [Source\nGenerator Behaviors](<doclink:source-generator-behaviors>).');
  });

  test('rewrites extensionless wiki links to known pages', () => {
    const output = rewriteDocMarkdown('[Multi target](./Multi-Targeting)', context());
    expect(output).toBe('[Multi target](<doclink:multi-targeting>)');
  });

  test('rewrites unknown source paths to GitHub blob URLs', () => {
    const output = rewriteDocMarkdown(
      '[src](src/src/Framework)',
      context({ sourcePath: 'docs', knownSlugs: new Set(['index']) }),
    );
    // A relative link from a doc page resolves relative to the docs directory.
    expect(output).toBe(
      '[src](https://github.com/purview-dev/demo/blob/main/docs/src/src/Framework)',
    );
  });

  test('rewrites parent-relative repo paths with normalisation', () => {
    const output = rewriteDocMarkdown(
      '[src](../src/Framework)',
      context({ sourcePath: 'docs', knownSlugs: new Set(['index']) }),
    );
    expect(output).toBe('[src](https://github.com/purview-dev/demo/blob/main/src/Framework)');
  });

  test('rewrites images to the image base', () => {
    const output = rewriteDocMarkdown('![Aspire](AspireTracesView.png)', context());
    expect(output).toBe(
      '![Aspire](https://github.com/purview-dev/demo/raw/main/docs/AspireTracesView.png)',
    );
  });

  test('keeps external URLs unchanged', () => {
    const output = rewriteDocMarkdown('[GitHub](https://github.com/purview-dev)', context());
    expect(output).toBe('[GitHub](https://github.com/purview-dev)');
  });

  test('keeps a fragment only when the target heading exists', () => {
    const kept = rewriteDocMarkdown('[Setup](SQL-Server-Guide.md#setup)', context());
    expect(kept).toBe('[Setup](<doclink:sql-server-guide>#setup)');
    const dropped = rewriteDocMarkdown('[Nope](SQL-Server-Guide.md#missing)', context());
    expect(dropped).toBe('[Nope](<doclink:sql-server-guide>)');
  });

  test('rewrites links to a non-index source root to the generated index page', () => {
    const output = rewriteDocMarkdown(
      '[Start](Getting-Started.md) and [Home](./Getting-Started)',
      context({
        knownSlugs: new Set(['index', 'advanced']),
        slugAliases: new Map([['getting-started', 'index']]),
      }),
    );
    expect(output).toBe('[Start](<doclink:index>) and [Home](<doclink:index>)');
  });
});

describe('docs root page selection', () => {
  test('allows a configured non-index root when no conventional root exists', () => {
    const selected = selectDocsRootFile(
      'value-objects',
      [rawDoc('docs/Getting-Started.md'), rawDoc('docs/ZodSharp-Validation.md')],
      'docs',
      'getting-started.md',
    );

    expect(selected.index.path).toBe('docs/Getting-Started.md');
    expect(selected.regular.map((file) => file.path)).toEqual(['docs/ZodSharp-Validation.md']);
    expect(selected.slugAliases.get('getting-started')).toBe('index');
  });

  test('honours docs.exclude before selecting a configured non-index root', () => {
    // `docs.exclude: [index.md]` drops the conventional root page before root
    // selection runs, which is what lets docs.rootPage name a different landing
    // page in repositories that ship a Backstage/TechDocs index.md.
    const sourceFiles = [
      rawDoc('docs/index.md'),
      rawDoc('docs/Getting-Started.md'),
      rawDoc('docs/API.md'),
    ];
    const included = sourceFiles.filter(
      (file) => !isExcluded(file.path.split('/').pop() ?? '', ['index.md']),
    );
    const selected = selectDocsRootFile('value-objects', included, 'docs', 'Getting-Started.md');

    expect(selected.index.path).toBe('docs/Getting-Started.md');
    expect(selected.regular.map((file) => file.path)).toEqual(['docs/API.md']);
    expect(selected.slugAliases.get('getting-started')).toBe('index');
  });

  test('rejects docs without a root page', () => {
    expect(() => selectDocsRootFile('demo', [rawDoc('docs/Guide.md')], 'docs', undefined)).toThrow(
      DocsValidationError,
    );
  });

  test('rejects a configured root page that does not exist', () => {
    expect(() =>
      selectDocsRootFile('demo', [rawDoc('docs/Guide.md')], 'docs', 'Missing.md'),
    ).toThrow(/does not exist/);
  });

  test('rejects a non-index configured root when an index already exists', () => {
    expect(() =>
      selectDocsRootFile(
        'demo',
        [rawDoc('docs/index.md'), rawDoc('docs/Getting-Started.md')],
        'docs',
        'Getting-Started.md',
      ),
    ).toThrow(/conventional root page already exists/);
  });

  test('points at the docs.exclude escape hatch when a conventional root exists', () => {
    expect(() =>
      selectDocsRootFile(
        'demo',
        [rawDoc('docs/index.md'), rawDoc('docs/Getting-Started.md')],
        'docs',
        'Getting-Started.md',
      ),
    ).toThrow(/docs\.exclude/);
  });
});

describe('docs exclude matching', () => {
  test('matches base file names exactly and supports wildcards', () => {
    expect(isExcluded('index.md', ['index.md'])).toBe(true);
    expect(isExcluded('Index.md', ['index.md'])).toBe(false);
    expect(isExcluded('_Sidebar.md', ['*.md'])).toBe(true);
    expect(isExcluded('Getting-Started.md', ['index.md', '_Sidebar.md'])).toBe(false);
    expect(isExcluded('index.md', undefined)).toBe(false);
  });
});

describe('resolveDocRelativeLink', () => {
  test('computes base-relative hrefs', () => {
    expect(resolveDocRelativeLink('getting-started', 'sql-server-guide')).toBe(
      '../sql-server-guide/',
    );
    expect(resolveDocRelativeLink('index', 'sql-server-guide')).toBe('sql-server-guide/');
    expect(resolveDocRelativeLink('getting-started', 'index')).toBe('../');
    expect(resolveDocRelativeLink('index', 'index')).toBe('./');
  });
});

describe('resolveRepoPath', () => {
  test('resolves parent segments', () => {
    expect(resolveRepoPath('docs/wiki', '../src/foo')).toBe('docs/src/foo');
    expect(resolveRepoPath('', 'src/src/Foo')).toBe('src/src/Foo');
    expect(resolveRepoPath('docs', 'src/src/Foo')).toBe('docs/src/src/Foo');
  });
});

describe('GitHub alerts', () => {
  test('parses alert blocks', () => {
    const markdown = ['> [!NOTE] Title', '> body line', '> ', '', '> [!WARNING]', '> danger'].join(
      '\n',
    );
    const blocks = parseGithubAlerts(markdown);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe('note');
    expect(blocks[0]?.title).toBe('Title');
    expect(blocks[1]?.type).toBe('caution');
  });

  test('converts to Starlight asides', () => {
    const markdown = ['> [!TIP] Tip title', '> tip body'].join('\n');
    const converted = convertGithubAlerts(markdown);
    expect(converted).toContain(':::tip[Tip title]');
    expect(converted).toContain('tip body');
    expect(converted).toContain(':::');
  });
});

describe('extractHeadingSlugs', () => {
  test('extracts lowercased heading slugs', () => {
    const markdown = [
      '# Title',
      '## Namespace Consolidation',
      '### OpenTelemetry-aligned naming',
    ].join('\n');
    const slugs = extractHeadingSlugs(markdown);
    expect(slugs.has('namespace-consolidation')).toBe(true);
    expect(slugs.has('opentelemetry-aligned-naming')).toBe(true);
  });
});
