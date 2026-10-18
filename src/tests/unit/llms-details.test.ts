import type { ResolvedProject } from '../../src/lib/manifest/load';

import { describe, expect, test } from 'bun:test';

import { buildLlmsDetails } from '../../src/lib/llms-details';
import { loadProjects } from '../../src/lib/manifest/load';

/** Load a real catalogue record so the synthetic cases carry realistic defaults. */
function fixtureProject(id: string): ResolvedProject {
  const found = loadProjects().find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing fixture project: ${id}`);
  }
  return found;
}

function project(overrides: Partial<ResolvedProject>): ResolvedProject {
  return { ...fixtureProject('zodsharp'), ...overrides };
}

describe('buildLlmsDetails', () => {
  test('names every active project and no archived one', () => {
    const details = buildLlmsDetails(loadProjects());
    for (const candidate of loadProjects()) {
      if (candidate.status === 'archived') {
        expect(details, `${candidate.id} is archived`).not.toContain(candidate.name);
      } else {
        expect(details, `${candidate.id} is active`).toContain(candidate.name);
      }
    }
  });

  test('reports the catalogue counts', () => {
    const details = buildLlmsDetails(loadProjects());
    expect(details).toContain('Purview Dev builds');
    expect(details).toMatch(/\d+ projects in \d+ categor/);
  });

  test('groups projects by their declared category', () => {
    const details = buildLlmsDetails([
      project({ id: 'alpha', name: 'Alpha', category: 'validation', status: 'stable', order: 10 }),
      project({ id: 'beta', name: 'Beta', category: 'validation', status: 'stable', order: 20 }),
      project({
        id: 'gamma',
        name: 'Gamma',
        category: 'build-tooling',
        status: 'preview',
        order: 30,
      }),
    ]);
    expect(details).toContain('validation (Alpha, Beta)');
    expect(details).toContain('build tooling (Gamma)');
    expect(details).toContain('3 projects in 2 categories');
  });

  test('excludes archived projects from the narrative', () => {
    const details = buildLlmsDetails([
      project({ id: 'alpha', name: 'Alpha', status: 'stable', order: 10 }),
      project({ id: 'old', name: 'Old Thing', status: 'archived', order: 20 }),
    ]);
    expect(details).not.toContain('Old Thing');
    expect(details).toContain('1 project in 1 category');
  });

  test('handles an empty catalogue', () => {
    const details = buildLlmsDetails([]);
    expect(details).toContain('Purview Dev builds open-source .NET developer tooling.');
    expect(details).not.toContain('categories');
  });
});
