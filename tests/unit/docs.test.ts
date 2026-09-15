import type { DocFrontmatter } from '../../src/lib/docs/frontmatter';
import type { DocLinkContext } from '../../src/lib/docs/links';

import { describe, expect, test } from 'bun:test';

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
      sourceRepo: 'purview-dev/eventsourcing',
      sourcePath: 'docs/wiki/Getting-Started.md',
      editUrl:
        'https://github.com/purview-dev/eventsourcing/edit/main/docs/wiki/Getting-Started.md',
    };
    const rendered = renderFrontmatter(frontmatter);
    expect(rendered).toContain('lastReviewed: "2026-09-15"');
    expect(rendered).toContain('owners: [purview-dev]');
    expect(rendered.startsWith('---')).toBe(true);
  });
});

describe('link rewriting', () => {
  test('rewrites relative md links to known pages', () => {
    const output = rewriteDocMarkdown('[Install](Getting-Started.md)', context());
    expect(output).toBe('[Install](<doclink:getting-started>)');
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
