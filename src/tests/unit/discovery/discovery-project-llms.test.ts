import { describe, expect, test } from 'bun:test';

import {
  renderProjectLlms,
  renderProjectLlmsFull,
  stripFrontmatter,
} from '../../../src/lib/discovery/project-llms';
import { loadProjects } from '../../../src/lib/manifest/load';

describe('per-project llms bundles', () => {
  const project = loadProjects().find((candidate) => candidate.id === 'zodsharp');

  test('the concise bundle links resources and documentation', () => {
    if (!project) throw new Error('zodsharp missing from catalogue');
    const content = renderProjectLlms(project, [
      { slug: 'index', title: 'ZodSharp' },
      { slug: 'core-concepts', title: 'Core concepts' },
    ]);
    expect(content).toContain(`# ${project.name}`);
    expect(content).toContain(project.sourceUrl);
    expect(content).toContain('https://purview.dev/docs/zodsharp/');
    expect(content).toContain('https://purview.dev/projects/zodsharp/llms-full.txt');
    expect(content).toContain('https://purview.dev/docs/zodsharp/core-concepts/');
  });

  test('the full bundle concatenates the docs mirror without frontmatter', () => {
    if (!project) throw new Error('zodsharp missing from catalogue');
    const content = renderProjectLlmsFull(
      project,
      [{ slug: 'index', title: 'ZodSharp' }],
      () => '---\ntitle: ZodSharp\n---\n\n# ZodSharp\n\nBody.',
    );
    expect(content).toContain('# ZodSharp');
    expect(content).toContain('Body.');
    expect(content).not.toContain('title: ZodSharp');
    expect(stripFrontmatter('---\na: b\n---\n\nHello')).toBe('Hello');
  });
});
