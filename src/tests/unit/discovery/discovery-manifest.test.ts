import type { DiscoverableResource } from '../../../src/lib/discovery/types';
import type { ReleaseCacheData } from '../../../src/lib/releases/types';

import { describe, expect, test } from 'bun:test';

import {
  assertCanonicalOrigin,
  buildIndexNowPayload,
  changeCount,
  chunk,
  diffDeploymentStates,
  diffResources,
  indexNowKeyLocation,
  redactSecret,
  urlsToSubmit,
} from '../../../src/lib/discovery/indexnow';
import {
  buildDeploymentState,
  buildDiscoveryManifest,
  buildManifestProjects,
  hashResource,
} from '../../../src/lib/discovery/manifest';
import { DISCOVERY_MANIFEST_SCHEMA_VERSION } from '../../../src/lib/discovery/types';
import { siteOrigin } from '../../../src/lib/discovery/urls';
import { loadProjects } from '../../../src/lib/manifest/load';

const emptyReleaseData: ReleaseCacheData = {
  schema: 1,
  retrievedAt: '2026-01-01T00:00:00.000Z',
  repos: {},
  releases: {},
  packages: {},
  packageSearch: {},
};

function resource(
  url: string,
  lastModified?: string,
  kind: DiscoverableResource['kind'] = 'page',
): DiscoverableResource {
  return { url, kind, lastModified, indexable: true };
}

describe('discovery manifest', () => {
  test('builds a versioned manifest from resources and projects', () => {
    const projects = loadProjects();
    const manifestProjects = buildManifestProjects(projects, emptyReleaseData, 'fixture');
    const manifest = buildDiscoveryManifest({
      resources: [
        resource('https://purview.dev/', '2025-01-01'),
        resource('https://purview.dev/projects/zodsharp/', '2025-02-02', 'project'),
      ],
      projects: manifestProjects,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(manifest.schemaVersion).toBe(DISCOVERY_MANIFEST_SCHEMA_VERSION);
    expect(manifest.url).toBe('https://purview.dev/');
    expect(manifest.sitemaps.index).toBe('https://purview.dev/sitemap-index.xml');
    expect(manifest.llms.full).toBe('https://purview.dev/llms-full.txt');
    expect(manifest.counts.resources).toBe(2);

    const zodsharp = manifest.projects.find((project) => project.slug === 'zodsharp');
    expect(zodsharp?.url).toBe('https://purview.dev/projects/zodsharp/');
    expect(zodsharp?.repository).toBe('purview-dev/zodsharp');
    expect(zodsharp?.llms?.summary).toBe('https://purview.dev/projects/zodsharp/llms.txt');
  });

  test('deployment state hashes resources deterministically', () => {
    const a = resource('https://purview.dev/about/', '2025-01-01');
    expect(hashResource(a)).toBe(hashResource({ ...a }));
    expect(hashResource(a)).not.toBe(
      hashResource(resource('https://purview.dev/about/', '2025-01-02')),
    );
    const state = buildDeploymentState([a], '2026-01-01T00:00:00.000Z');
    expect(Object.keys(state.resources)).toEqual(['https://purview.dev/about/']);
  });
});

describe('indexnow change detection', () => {
  test('everything is added when there is no previous deployment', () => {
    const changes = diffResources(null, [
      resource('https://purview.dev/a/'),
      resource('https://purview.dev/b/'),
    ]);
    expect(changes.added).toEqual(['https://purview.dev/a/', 'https://purview.dev/b/']);
    expect(changes.modified).toEqual([]);
    expect(changes.deleted).toEqual([]);
  });

  test('detects modified and deleted URLs', () => {
    const previous = [
      resource('https://purview.dev/a/', '2025-01-01'),
      resource('https://purview.dev/b/', '2025-01-01'),
      resource('https://purview.dev/c/', '2025-01-01'),
    ];
    const current = [
      resource('https://purview.dev/a/', '2025-01-01'),
      resource('https://purview.dev/b/', '2025-02-02'),
      resource('https://purview.dev/d/', '2025-02-02'),
    ];
    const changes = diffResources(previous, current);
    expect(changes.added).toEqual(['https://purview.dev/d/']);
    expect(changes.modified).toEqual(['https://purview.dev/b/']);
    expect(changes.deleted).toEqual(['https://purview.dev/c/']);
    expect(urlsToSubmit(changes)).toEqual(['https://purview.dev/b/', 'https://purview.dev/d/']);
    expect(changeCount(changes)).toBe(3);
  });

  test('diffDeploymentStates compares content hashes', () => {
    const previous = buildDeploymentState([resource('https://purview.dev/a/', '2025-01-01')], 'x');
    const current = buildDeploymentState([resource('https://purview.dev/a/', '2025-01-01')], 'y');
    expect(diffDeploymentStates(previous, current).modified).toEqual([]);
  });
});

describe('indexnow payloads and safety', () => {
  test('chunks URLs at the protocol limit', () => {
    const urls = Array.from({ length: 5 }, (_, index) => `https://purview.dev/${index}/`);
    expect(chunk(urls, 2)).toHaveLength(3);
    expect(chunk(urls, 2)[2]).toEqual(['https://purview.dev/4/']);
    expect(() => chunk(urls, 0)).toThrow();
  });

  test('builds a payload and refuses off-origin URLs', () => {
    const payload = buildIndexNowPayload('purview.dev', 'key', 'https://purview.dev/key.txt', [
      'https://purview.dev/a/',
    ]);
    expect(payload.host).toBe('purview.dev');
    expect(payload.urlList).toEqual(['https://purview.dev/a/']);
    expect(() => assertCanonicalOrigin(['https://purview.dev/a/'], siteOrigin())).not.toThrow();
    expect(() => assertCanonicalOrigin(['https://evil.example/a/'], siteOrigin())).toThrow(
      /outside https:\/\/purview.dev/,
    );
  });

  test('key location and redaction', () => {
    expect(indexNowKeyLocation('https://purview.dev/', 'abc12345')).toBe(
      'https://purview.dev/abc12345.txt',
    );
    expect(redactSecret('key=abc12345 end', 'abc12345')).toBe('key=[redacted] end');
    expect(redactSecret('no secret here', undefined)).toBe('no secret here');
  });
});
