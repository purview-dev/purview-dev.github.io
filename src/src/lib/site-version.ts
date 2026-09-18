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

export function siteVersion(): string {
  return readVersion(findWorkspaceRoot());
}
