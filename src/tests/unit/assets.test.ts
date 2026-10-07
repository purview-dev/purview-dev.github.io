import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { collectAssets } from '../../scripts/sync-assets';
import { loadProjects } from '../../src/lib/manifest/load';

describe('project asset mirroring', () => {
  test('collects the declared assets with their repository and output', () => {
    const assets = collectAssets(loadProjects());
    const build = assets.find((asset) => asset.projectId === 'build');
    expect(build).toEqual({
      projectId: 'build',
      repository: 'purview-dev/build',
      path: 'purview-build.schema.json',
      output: 'schemas/purview-build.json',
      description: expect.any(String),
    });
  });

  test('every declared output is a unique, relative path', () => {
    const assets = collectAssets(loadProjects());
    const outputs = assets.map((asset) => asset.output);
    expect(new Set(outputs).size).toBe(outputs.length);
    for (const output of outputs) {
      expect(output.startsWith('/')).toBe(false);
      expect(output.split('/')).not.toContain('..');
    }
  });

  test('the committed fixture is a valid JSON Schema', () => {
    const fixture = resolve('fixtures/assets/build/purview-build.schema.json');
    const schema = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTypeOf('object');
  });
});
