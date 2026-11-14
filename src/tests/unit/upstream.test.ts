import { describe, expect, test } from 'bun:test';

import {
  parseLsRemote,
  readUpstreamState,
  upstreamChanges,
  type UpstreamState,
} from '../../src/lib/upstream';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function state(overrides: Partial<UpstreamState['projects'][string]> = {}): UpstreamState {
  return {
    schema: 1,
    generatedAt: '2026-11-14T00:00:00.000Z',
    projects: {
      unions: {
        repository: 'purview-dev/unions',
        head: SHA_A,
        tags: 'tags-1',
        packages: { 'nuget:Purview.Unions': '1.0.0-prerelease.3' },
        ...overrides,
      },
    },
  };
}

describe('upstream state', () => {
  test('parses git ls-remote output', () => {
    expect(parseLsRemote(`${SHA_A}\tHEAD\n${SHA_B}\trefs/tags/v1.0.0\nnot a line\n`)).toEqual(
      new Map([
        ['HEAD', SHA_A],
        ['refs/tags/v1.0.0', SHA_B],
      ]),
    );
  });

  test('reads only a document of the current schema', () => {
    expect(readUpstreamState(state())).not.toBeNull();
    expect(readUpstreamState({ schema: 0, projects: {} })).toBeNull();
    expect(readUpstreamState(null)).toBeNull();
  });

  test('nothing moved is no change', () => {
    expect(upstreamChanges(state(), state())).toEqual([]);
  });

  test('a new commit, tag or package version is a change', () => {
    expect(upstreamChanges(state(), state({ head: SHA_B }))).toEqual([
      'unions: purview-dev/unions default branch aaaaaaa → bbbbbbb',
    ]);
    expect(upstreamChanges(state(), state({ tags: 'tags-2' }))).toHaveLength(1);
    expect(
      upstreamChanges(state(), state({ packages: { 'nuget:Purview.Unions': '1.0.0' } })),
    ).toEqual(['unions: nuget:Purview.Unions 1.0.0-prerelease.3 → 1.0.0']);
  });

  test('a value that could not be read is never a change', () => {
    expect(upstreamChanges(state(), state({ head: null, tags: null }))).toEqual([]);
    expect(upstreamChanges(state(), state({ packages: { 'nuget:Purview.Unions': null } }))).toEqual(
      [],
    );
  });

  test('a catalogue change, or no recorded state, is a change', () => {
    const added = state();
    added.projects.results = { ...added.projects.unions!, repository: 'purview-dev/results' };
    expect(upstreamChanges(state(), added)).toEqual(['results: new in the catalogue']);
    expect(upstreamChanges(added, state())).toEqual(['results: removed from the catalogue']);
    expect(upstreamChanges(null, state())).toHaveLength(1);
  });
});
