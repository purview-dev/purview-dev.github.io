import { describe, expect, test } from 'bun:test';

import { resolveGitHubTokenFrom } from '../../src/lib/github/token';

function sources(
  overrides: {
    ghAuthToken?: string | undefined;
    env?: Record<string, string | undefined>;
  } = {},
): {
  ghAuthToken: () => string | undefined;
  env: Record<string, string | undefined>;
} {
  return {
    ghAuthToken: () => overrides.ghAuthToken,
    env: overrides.env ?? {},
  };
}

describe('resolveGitHubTokenFrom', () => {
  test('prefers the GitHub CLI token', () => {
    const token = resolveGitHubTokenFrom(
      sources({ ghAuthToken: 'gho_cli', env: { GITHUB_TOKEN: 'env-token' } }),
    );
    expect(token).toBe('gho_cli');
  });

  test('falls back to GITHUB_TOKEN when gh has no token', () => {
    const token = resolveGitHubTokenFrom(sources({ env: { GITHUB_TOKEN: 'env-token' } }));
    expect(token).toBe('env-token');
  });

  test('falls back to GH_TOKEN when GITHUB_TOKEN is absent', () => {
    const token = resolveGitHubTokenFrom(sources({ env: { GH_TOKEN: 'gh-token' } }));
    expect(token).toBe('gh-token');
  });

  test('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    const token = resolveGitHubTokenFrom(
      sources({ env: { GITHUB_TOKEN: 'primary', GH_TOKEN: 'secondary' } }),
    );
    expect(token).toBe('primary');
  });

  test('trims whitespace from environment tokens', () => {
    const token = resolveGitHubTokenFrom(sources({ env: { GITHUB_TOKEN: '  padded  ' } }));
    expect(token).toBe('padded');
  });

  test('returns undefined when no source is available', () => {
    const token = resolveGitHubTokenFrom(sources({ env: {} }));
    expect(token).toBeUndefined();
  });
});
