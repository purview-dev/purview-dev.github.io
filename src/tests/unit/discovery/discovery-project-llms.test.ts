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

  const live = {
    id: 'live',
    label: '2.4.2',
    version: '2.4.2',
    ref: 'v2.4.2',
    default: true,
  } as const;
  const prerelease = {
    id: 'prerelease',
    label: '3.0.0-prerelease.2',
    version: '3.0.0-prerelease.2',
    ref: 'main',
    default: false,
  } as const;

  test('a versioned bundle names its version and links the other versions', () => {
    if (!project) throw new Error('zodsharp missing from catalogue');
    const content = renderProjectLlms(
      project,
      [
        { slug: 'index', title: 'ZodSharp' },
        { slug: 'core-concepts', title: 'Core concepts' },
      ],
      {
        channel: live,
        channels: [live, prerelease],
        docsBaseUrl: 'https://purview.dev/docs/zodsharp/',
        fullUrl: 'https://purview.dev/projects/zodsharp/llms-full.txt',
      },
    );
    expect(content).toContain('## Documentation version');
    expect(content).toContain('- Version: 2.4.2');
    expect(content).toContain('- Channel: live (default)');
    expect(content).toContain('- Source: purview-dev/zodsharp@v2.4.2');
    // The other version's bundle is linked, not merged into this corpus.
    expect(content).toContain('## Other versions');
    expect(content).toContain('https://purview.dev/projects/zodsharp/prerelease/llms.txt');
    expect(content).toContain('https://purview.dev/docs/zodsharp/core-concepts/');
    expect(content).not.toContain('https://purview.dev/docs/zodsharp/prerelease/core-concepts/');
  });

  test('the full bundle documents exactly one version', () => {
    if (!project) throw new Error('zodsharp missing from catalogue');
    const content = renderProjectLlmsFull(
      project,
      [{ slug: 'index', title: 'ZodSharp' }],
      () => '---\ntitle: ZodSharp\n---\n\n# ZodSharp\n\nPrerelease body.',
      {
        channel: prerelease,
        channels: [live, prerelease],
        docsBaseUrl: 'https://purview.dev/docs/zodsharp/prerelease/',
        fullUrl: 'https://purview.dev/projects/zodsharp/prerelease/llms-full.txt',
        summaryUrl: 'https://purview.dev/projects/zodsharp/prerelease/llms.txt',
      },
    );
    expect(content).toContain('- Version: 3.0.0-prerelease.2');
    expect(content).toContain('- Channel: prerelease');
    expect(content).toContain(
      'Full machine-readable content: https://purview.dev/projects/zodsharp/prerelease/llms-full.txt',
    );
    expect(content).toContain(
      'Concise machine-readable index: https://purview.dev/projects/zodsharp/prerelease/llms.txt',
    );
    expect(content).toContain('Prerelease body.');
    expect(content).not.toContain('https://purview.dev/docs/zodsharp/core-concepts/');
  });
});
