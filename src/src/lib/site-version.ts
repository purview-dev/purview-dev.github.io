import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
/**
 * Locate the workspace root: the nearest ancestor package.json that declares a
 * `workspaces` array. This is the repository root, which owns the site's
 * release version (the same file Purview.Build reads to tag `v{version}`).
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let directory = resolve(startDir);
  for (;;) {
    const packagePath = join(directory, 'package.json');
    if (existsSync(packagePath)) {
      const manifest: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));
      const workspaces = (manifest as { workspaces?: unknown }).workspaces;
      if (Array.isArray(workspaces) && workspaces.length > 0) {
        return directory;
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate a workspace root above ${startDir}`);
    }
    directory = parent;
  }
}

/**
 * The site's own version, read from the workspace-root package.json. Used in
 * the footer and asserted by the built-output tests.
 */
export function readVersion(root: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = (manifest as { version?: string }).version;
  if (!version) {
    throw new Error(
      `The workspace root package.json at ${join(root, 'package.json')} has no version.`,
    );
  }
  return version;
}

/**
 * Gets the full Git commit SHA for the revision being built.
 *
 * CI-provided values are preferred because some build environments use shallow
 * clones or do not make the .git directory available. Local builds fall back
 * to querying Git directly.
 */
export function readCommitSha(root: string): string {
  const environmentSha =
    process.env.GITHUB_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA;

  if (environmentSha) {
    return environmentSha;
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getReleaseInfo(): ReleaseInfo {
  const root = findWorkspaceRoot();
  return {
    version: readVersion(root),
    commitSha: readCommitSha(root),
    buildDate: new Date(),
  };
}

export interface ReleaseInfo {
  version: string;
  commitSha: string;
  buildDate: Date;
}
