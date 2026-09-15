import { describe, expect, test } from 'bun:test';

import { loadProjects, parseManifest } from '../../src/lib/manifest/load';
import { ManifestValidationError } from '../../src/lib/manifest/load';

describe('project manifest', () => {
  test('loads and validates the real manifest', () => {
    const projects = loadProjects();
    expect(projects.length).toBeGreaterThanOrEqual(8);
    const ids = projects.map((p) => p.id);
    expect(ids).toContain('telemetry-sourcegenerator');
    expect(ids).toContain('event-sourcing');
    expect(ids).toContain('zodsharp');
  });

  test('sorts projects by declared order', () => {
    const projects = loadProjects();
    const orders = projects.map((p) => p.order);
    expect(orders).toEqual([...orders].toSorted((a, b) => a - b));
  });

  test('expands repository and URL fields', () => {
    const projects = loadProjects();
    const telemetry = projects.find((p) => p.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    expect(telemetry?.repoOwner).toBe('purview-dev');
    expect(telemetry?.repoName).toBe('telemetry-sourcegenerator');
    expect(telemetry?.sourceUrl).toBe('https://github.com/purview-dev/telemetry-sourcegenerator');
  });

  test('rejects a repository outside the purview-dev org', () => {
    expect(() =>
      parseManifest(
        {
          projects: [
            {
              id: 'other',
              name: 'Other',
              shortDescription: 'x',
              description: 'x',
              repository: 'someone-else/repo',
              category: 'validation',
              status: 'preview',
            },
          ],
        },
        'fixture.yml',
      ),
    ).toThrow(ManifestValidationError);
  });

  test('rejects a relationship to an unknown project id', () => {
    expect(() =>
      parseManifest(
        {
          projects: [
            {
              id: 'a',
              name: 'A',
              shortDescription: 'x',
              description: 'x',
              repository: 'purview-dev/a',
              category: 'validation',
              status: 'preview',
              related: ['does-not-exist'],
            },
          ],
        },
        'fixture.yml',
      ),
    ).toThrow(/does-not-exist/);
  });

  test('rejects duplicate package ids across projects', () => {
    expect(() =>
      parseManifest({ projects: [makeProject('a'), makeProject('b')] }, 'fixture.yml'),
    ).toThrow(ManifestValidationError);
  });
});

function makeProject(id: string): {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  repository: string;
  category: 'validation';
  status: 'preview';
  packages: { id: string }[];
} {
  return {
    id,
    name: id,
    shortDescription: 'x',
    description: 'x',
    repository: `purview-dev/${id}`,
    category: 'validation',
    status: 'preview',
    packages: [{ id: 'Purview.Shared' }],
  };
}
