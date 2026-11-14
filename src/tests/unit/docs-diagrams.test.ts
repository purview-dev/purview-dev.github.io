import { describe, expect, test } from 'bun:test';

import {
  applyDiagramBlocks,
  declaredViews,
  diagramModelPaths,
  findDiagramBlocks,
  renderLikec4Fence,
  resolveDiagramPath,
} from '../../src/lib/docs/diagrams';

const MODEL = `specification { element step }
model {
  resume = step 'pm-resume'
  next = step 'pm-next'
  resume -> next
}
views {
  view theLoop {
    include *
  }
}`;

const PAGE = [
  '# PM Skills',
  '',
  '## The loop',
  '',
  '<!-- purview:likec4 file="./docs/diagrams/the-loop.c4" view="theLoop" title="The loop" -->',
  '```mermaid',
  'flowchart LR',
  '  resume --> next',
  '```',
  '',
  '[LikeC4 model](./docs/diagrams/the-loop.c4)',
  '<!-- /purview:likec4 -->',
  '',
  'After the diagram.',
].join('\n');

describe('diagram pairs', () => {
  test('finds a marked block and its options', () => {
    const { blocks, problems } = findDiagramBlocks(PAGE);
    expect(problems).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.options).toEqual({
      file: './docs/diagrams/the-loop.c4',
      view: 'theLoop',
      title: 'The loop',
    });
    expect(blocks[0]?.inner).toContain('```mermaid');
  });

  test('ignores markers shown inside a code fence', () => {
    const documented = ['````md', PAGE, '````'].join('\n');
    expect(findDiagramBlocks(documented).blocks).toEqual([]);
  });

  test('reports a block that is never closed', () => {
    const { blocks, problems } = findDiagramBlocks('<!-- purview:likec4 file="a.c4" -->\ntext');
    expect(blocks).toEqual([]);
    expect(problems[0]).toContain('never closed');
  });

  test('resolves a model path against the page, and refuses to leave the repository', () => {
    expect(resolveDiagramPath('README.md', './docs/diagrams/the-loop.c4')).toBe(
      'docs/diagrams/the-loop.c4',
    );
    expect(resolveDiagramPath('docs/wiki/guide/Loop.md', '../diagrams/loop.c4')).toBe(
      'docs/wiki/diagrams/loop.c4',
    );
    expect(resolveDiagramPath('docs/wiki/Loop.md', '/models/loop.c4')).toBe('models/loop.c4');
    expect(resolveDiagramPath('README.md', '../outside.c4')).toBeNull();
  });

  test('lists the model files a page needs', () => {
    expect(diagramModelPaths(PAGE, 'README.md')).toEqual(['docs/diagrams/the-loop.c4']);
  });

  test('reads the declared views, dynamic ones included', () => {
    expect([...declaredViews(`${MODEL}\nviews { dynamic view flow { } }`)]).toEqual([
      'theLoop',
      'flow',
    ]);
  });

  test('replaces the whole block with a likec4 fence of the model', () => {
    const { markdown, warnings } = applyDiagramBlocks(
      PAGE,
      'README.md',
      new Map([['docs/diagrams/the-loop.c4', MODEL]]),
    );
    expect(warnings).toEqual([]);
    expect(markdown).toContain('```likec4 view="theLoop" title="The loop"\nspecification');
    expect(markdown).not.toContain('mermaid');
    expect(markdown).not.toContain('purview:likec4');
    expect(markdown).not.toContain('[LikeC4 model]');
    expect(markdown).toContain('After the diagram.');
  });

  test('keeps the Mermaid rendering when the model cannot be read', () => {
    const { markdown, warnings } = applyDiagramBlocks(
      PAGE,
      'README.md',
      new Map([['docs/diagrams/the-loop.c4', null]]),
    );
    expect(markdown).toContain('```mermaid');
    expect(markdown).not.toContain('purview:likec4');
    expect(warnings[0]).toContain('could not be read');
  });

  test('keeps the Mermaid rendering when the model lacks the view', () => {
    const { markdown, warnings } = applyDiagramBlocks(
      PAGE.replace('view="theLoop"', 'view="missing"'),
      'README.md',
      new Map([['docs/diagrams/the-loop.c4', MODEL]]),
    );
    expect(markdown).toContain('```mermaid');
    expect(warnings[0]).toContain('no view "missing"');
  });

  test('a fence is longer than any backtick run in the model', () => {
    expect(renderLikec4Fence('a ``` b', {}).startsWith('````likec4\n')).toBe(true);
  });
});
