import type { ResolvedProject } from '../../src/lib/manifest/load';
import type { NuGetSearchEntry, ReleaseCacheData } from '../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkProjects,
  targetFrameworkFindings,
  versionConsistencyFindings,
} from '../../scripts/check-projects';
import { loadProjects } from '../../src/lib/manifest/load';
import { RELEASE_CACHE_SCHEMA_VERSION } from '../../src/lib/releases/types';

/**
 * The catalogue guard reads the generated docs cache, which only exists after a
 * data sync (`just data-sync`, or any build). `just validate` syncs before it
 * runs the test suite, so the assertion is active there and in CI; a bare
 * `bun run test` on a fresh clone skips it instead of failing on missing data.
 */
const HAS_DOCS_CACHE = existsSync(resolve('.cache/docs/index.json'));

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

interface PackageInput {
  versions: string[];
  targetFrameworks?: string[];
}

function cache(
  packages: Record<string, PackageInput>,
  search: Record<string, NuGetSearchEntry | null> = {},
): ReleaseCacheData {
  return {
    schema: RELEASE_CACHE_SCHEMA_VERSION,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    repos: {},
    releases: {},
    packages: Object.fromEntries(
      Object.entries(packages).map(([id, value]) => [id, { id, ...value }]),
    ),
    packageSearch: search,
  };
}

function searchEntry(overrides: Partial<NuGetSearchEntry> = {}): NuGetSearchEntry {
  return {
    id: 'Purview.ZodSharp',
    version: '2.0.1',
    description: null,
    totalDownloads: 0,
    tags: [],
    published: null,
    deprecated: false,
    listed: true,
    ...overrides,
  };
}

describe('catalogue guard', () => {
  test.skipIf(!HAS_DOCS_CACHE)('the committed catalogue passes every invariant', () => {
    const { errors } = checkProjects();
    expect(
      errors.map((finding) => `[${finding.project}] ${finding.field}: ${finding.observed}`),
    ).toEqual([]);
  });

  test('every finding carries the detail needed to remediate it', () => {
    const { errors, warnings } = checkProjects();
    for (const finding of [...errors, ...warnings]) {
      expect(finding.project.length).toBeGreaterThan(0);
      expect(finding.field.length).toBeGreaterThan(0);
      expect(finding.expected.length).toBeGreaterThan(0);
      expect(finding.remediation.length).toBeGreaterThan(0);
    }
  });
});

describe('version consistency findings', () => {
  test('flags a preview project that already ships a stable package', () => {
    const findings = versionConsistencyFindings(
      project({ status: 'preview', experimental: false, packages: [{ id: 'Purview.ZodSharp' }] }),
      cache({ 'Purview.ZodSharp': { versions: ['1.0.0', '2.0.0-prerelease.1'] } }),
    );
    expect(findings.map((finding) => finding.field)).toContain('status');
  });

  test('does not flag an experimental project for staying preview', () => {
    const findings = versionConsistencyFindings(
      project({ status: 'preview', experimental: true, packages: [{ id: 'Purview.ZodSharp' }] }),
      cache({ 'Purview.ZodSharp': { versions: ['1.0.0'] } }),
    );
    expect(findings).toEqual([]);
  });

  test('flags deprecated and unlisted packages', () => {
    const findings = versionConsistencyFindings(
      project({ status: 'stable', packages: [{ id: 'Purview.ZodSharp' }] }),
      cache(
        { 'Purview.ZodSharp': { versions: ['2.0.1'] } },
        { 'Purview.ZodSharp': searchEntry({ deprecated: true, listed: false }) },
      ),
    );
    const observed = findings.map((finding) => finding.observed);
    expect(observed).toContain('deprecated on NuGet');
    expect(observed).toContain('unlisted on NuGet');
  });

  test('ignores archived projects', () => {
    const findings = versionConsistencyFindings(
      project({ status: 'archived', packages: [{ id: 'Purview.ZodSharp' }] }),
      cache({ 'Purview.ZodSharp': { versions: ['1.0.0'] } }),
    );
    expect(findings).toEqual([]);
  });
});

describe('target framework findings', () => {
  test('flags a project whose declared frameworks miss a published one', () => {
    const findings = targetFrameworkFindings(
      project({ targetFrameworks: ['net8.0'], packages: [{ id: 'Purview.ZodSharp' }] }),
      cache({
        'Purview.ZodSharp': { versions: ['1.0.0'], targetFrameworks: ['net8.0', 'net9.0'] },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.field).toBe('targetFrameworks');
    expect(findings[0]?.observed).toContain('missing net9.0');
  });

  test('flags a project that declares no frameworks at all', () => {
    const findings = targetFrameworkFindings(
      project({ targetFrameworks: undefined, packages: [{ id: 'Purview.ZodSharp' }] }),
      cache({ 'Purview.ZodSharp': { versions: ['1.0.0'], targetFrameworks: ['net8.0'] } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.observed).toBe('none');
  });

  test('treats netstandard2.0 as an analyzer target, not a consumer framework', () => {
    const findings = targetFrameworkFindings(
      project({
        targetFrameworks: ['net8.0', 'net9.0', 'net10.0'],
        packages: [
          { id: 'Purview.Telemetry.SourceGenerator', targetFrameworks: ['netstandard2.0'] },
        ],
      }),
      cache({
        'Purview.Telemetry.SourceGenerator': {
          versions: ['5.0.1'],
          targetFrameworks: ['.NETStandard2.0'],
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  test('recommends a package-level override for an undeclared analyzer package', () => {
    const findings = targetFrameworkFindings(
      project({
        targetFrameworks: ['net8.0'],
        packages: [{ id: 'Purview.Results' }, { id: 'Purview.Results.SourceGenerator' }],
      }),
      cache({
        'Purview.Results': { versions: ['1.0.0'], targetFrameworks: ['net8.0'] },
        'Purview.Results.SourceGenerator': {
          versions: ['1.0.0'],
          targetFrameworks: ['netstandard2.0'],
        },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.field).toBe('packages["Purview.Results.SourceGenerator"]');
  });

  test('skips framework equality for tool and SDK projects', () => {
    const findings = targetFrameworkFindings(
      project({
        install: 'msbuild-sdk',
        targetFrameworks: ['msbuild'],
        packages: [{ id: 'Purview.BuildSdk' }],
      }),
      cache({ 'Purview.BuildSdk': { versions: ['1.0.3'], targetFrameworks: ['netstandard2.0'] } }),
    );
    expect(findings).toEqual([]);
  });

  test('flags an invalid framework moniker', () => {
    const findings = targetFrameworkFindings(
      project({ targetFrameworks: ['dotnet'], packages: [] }),
      cache({}),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.observed).toBe('dotnet');
  });
});
