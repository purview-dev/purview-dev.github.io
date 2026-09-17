import { describe, expect, test } from 'bun:test';

import { loadExternalProjects, loadProjects, parseManifest } from '../../src/lib/manifest/load';
import { ManifestValidationError } from '../../src/lib/manifest/load';

describe('project manifest', () => {
  test('loads and validates the real manifest', () => {
    const projects = loadProjects();
    expect(projects.length).toBeGreaterThanOrEqual(8);
    const ids = projects.map((p) => p.id);
    expect(ids).toContain('telemetry-sourcegenerator');
    expect(ids).toContain('event-sourcing');
    expect(ids).toContain('zodsharp');
    expect(ids).toContain('aspirec4');
  });

  test('loads external (collaboration) projects', () => {
    const external = loadExternalProjects();
    const likec4 = external.find((project) => project.id === 'likec4');
    expect(likec4).toBeDefined();
    expect(likec4?.url).toBe('https://likec4.dev');
    expect(likec4?.repository).toBe('likec4/likec4');
    expect(likec4?.repoUrl).toBe('https://github.com/likec4/likec4');
    expect(external.some((project) => project.id.startsWith('purview-'))).toBe(false);
  });

  test('sorts projects by declared order', () => {
    const projects = loadProjects();
    const orders = projects.map((p) => p.order);
    expect(orders).toEqual([...orders].toSorted((a, b) => a - b));
  });

  test('project names do not repeat the "Purview " organisation prefix', () => {
    for (const project of loadProjects()) {
      expect(project.name.startsWith('Purview ')).toBe(false);
    }
  });

  test('expands repository and URL fields', () => {
    const projects = loadProjects();
    const telemetry = projects.find((p) => p.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    expect(telemetry?.repoOwner).toBe('purview-dev');
    expect(telemetry?.repoName).toBe('telemetry-sourcegenerator');
    expect(telemetry?.sourceUrl).toBe('https://github.com/purview-dev/telemetry-sourcegenerator');
  });

  test('resolves the install kind, defaulting to nuget', () => {
    const projects = loadProjects();
    const telemetry = projects.find((p) => p.id === 'telemetry-sourcegenerator');
    expect(telemetry?.install).toBe('nuget');
    const sdk = projects.find((p) => p.id === 'dotnet-project-sdk');
    expect(sdk?.install).toBe('msbuild-sdk');
    const build = projects.find((p) => p.id === 'build');
    expect(build?.install).toBe('dotnet-tool');
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
