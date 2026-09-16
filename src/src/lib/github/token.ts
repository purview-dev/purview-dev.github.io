export interface GitHubTokenSources {
  ghAuthToken: () => string | undefined;
  env: Record<string, string | undefined>;
}

const TOKEN_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN'] as const;

/**
 * Resolve a GitHub authentication token from the provided sources, preferring
 * the GitHub CLI, then the GITHUB_TOKEN/GH_TOKEN environment variables.
 * Returns undefined when no token is available; callers fall back to
 * unauthenticated requests.
 */
export function resolveGitHubTokenFrom(sources: GitHubTokenSources): string | undefined {
  const fromGh = sources.ghAuthToken();
  if (fromGh) {
    return fromGh;
  }
  for (const key of TOKEN_ENV_VARS) {
    const value = sources.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

let cachedToken: string | undefined | null;

function ghAuthToken(): string | undefined {
  try {
    const result = Bun.spawnSync(['gh', 'auth', 'token'], { timeout: 10_000 });
    if (result.exitCode === 0) {
      const token = result.stdout.toString().trim();
      if (token) {
        return token;
      }
    }
  } catch {
    // gh is not installed or could not be run; fall through to env vars.
  }
  return undefined;
}

/**
 * Resolve the GitHub authentication token for this process, preferring the
 * GitHub CLI (`gh auth token`), then the GITHUB_TOKEN/GH_TOKEN environment
 * variables, then unauthenticated. The result is memoized for the process.
 */
export function resolveGitHubToken(): string | undefined {
  if (cachedToken !== undefined) {
    return cachedToken ?? undefined;
  }
  const token = resolveGitHubTokenFrom({ ghAuthToken, env: process.env });
  cachedToken = token ?? null;
  return token;
}
