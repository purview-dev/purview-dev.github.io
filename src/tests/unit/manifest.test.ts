import { describe, expect, test } from 'bun:test';

import { loadExternalProjects, loadProjects, parseManifest } from '../../src/lib/manifest/load';
import { ManifestValidationError } from '../../src/lib/manifest/load';
import { AUDIENCES } from '../../src/lib/manifest/schema';

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

  test('records the upstream work credited by derived projects', () => {
    const projects = loadProjects();
    const zodsharp = projects.find((project) => project.id === 'zodsharp');
    expect(zodsharp).toBeDefined();
    expect(zodsharp?.acknowledgments.map((item) => item.url)).toEqual([
      'https://github.com/colinhacks/zod',
      'https://github.com/guinhx/ZodSharp',
    ]);

    // Every other project resolves to an empty list rather than undefined.
    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry?.acknowledgments).toEqual([]);
  });

  test('rejects an acknowledgment with an invalid url', () => {
    expect(() =>
      parseManifest(
        {
          projects: [
            {
              ...makeProject('a'),
              acknowledgments: [{ name: 'Zod', url: 'not-a-url' }],
            },
          ],
        },
        'fixture.yml',
      ),
    ).toThrow(ManifestValidationError);
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
    const sdk = projects.find((p) => p.id === 'build-sdk');
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
              origin: 'x',
              useWhen: 'x',
              avoidWhen: 'x',
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
              origin: 'x',
              useWhen: 'x',
              avoidWhen: 'x',
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

describe('project use cases', () => {
  test('loads concrete use cases from the real manifest', () => {
    const projects = loadProjects();
    const withUseCases = projects.filter((project) => project.useCases.length > 0);
    expect(withUseCases.length).toBeGreaterThanOrEqual(8);

    const telemetry = projects.find((project) => project.id === 'telemetry-sourcegenerator');
    const first = telemetry?.useCases[0];
    expect(first?.audience).toBe('developer');
    expect(first?.title.length).toBeGreaterThan(0);
    expect(first?.scenario.length).toBeGreaterThan(0);
    expect(first?.outcome.length).toBeGreaterThan(0);
    expect(first?.code).toContain('interface IOrderServiceTelemetry');
    expect(first?.language).toBe('csharp');
  });

  test('every use case carries a known audience and an outcome', () => {
    for (const project of loadProjects()) {
      for (const useCase of project.useCases) {
        expect(AUDIENCES).toContain(useCase.audience);
        expect(useCase.outcome.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('deep links only appear on projects that publish documentation', () => {
    for (const project of loadProjects()) {
      for (const useCase of project.useCases) {
        if (useCase.docsPage !== undefined) {
          expect(project.docs, `${project.id} links to docs without a docs config`).toBeDefined();
        }
      }
    }
  });

  test('projects without use cases resolve to an empty list', () => {
    const projects = parseManifest({ projects: [makeProject('a')] }, 'fixture.yml');
    expect(projects[0]?.useCases).toEqual([]);
  });

  test('rejects an unknown audience', () => {
    expect(() =>
      parseManifest(
        {
          projects: [
            {
              ...makeProject('a'),
              useCases: [
                {
                  audience: 'executive',
                  title: 'x',
                  scenario: 'x',
                  outcome: 'x',
                },
              ],
            },
          ],
        },
        'fixture.yml',
      ),
    ).toThrow(ManifestValidationError);
  });

  test('requires a language when code is provided', () => {
    expect(() =>
      parseManifest(
        {
          projects: [
            {
              ...makeProject('a'),
              useCases: [
                {
                  audience: 'developer',
                  title: 'x',
                  scenario: 'x',
                  outcome: 'x',
                  code: 'Console.WriteLine("hi");',
                },
              ],
            },
          ],
        },
        'fixture.yml',
      ),
    ).toThrow(/language/);
  });
});

function makeProject(id: string): {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  origin: string;
  useWhen: string;
  avoidWhen: string;
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
    origin: 'x',
    useWhen: 'x',
    avoidWhen: 'x',
    repository: `purview-dev/${id}`,
    category: 'validation',
    status: 'preview',
    packages: [{ id: 'Purview.Shared' }],
  };
}
