import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadProjects } from '../src/lib/manifest/load';
import {
  parseLsRemote,
  readUpstreamState,
  UPSTREAM_STATE_SCHEMA,
  upstreamChanges,
  type UpstreamProjectState,
  type UpstreamState,
} from '../src/lib/upstream';

/**
 * Record or compare the upstream state the site is built from (ADR 0014).
 *
 *   bun run scripts/upstream-state.ts --write dist/_discovery/upstream.json
 *   bun run scripts/upstream-state.ts --compare https://purview.dev/_discovery/upstream.json
 *
 * `--write` runs in the deploy workflow, after the build, so the deployed site
 * carries the state it was built from. `--compare` runs in the scheduled
 * refresh: it prints what moved and sets `changed=true|false` in
 * `$GITHUB_OUTPUT`. Repository refs are read with `git ls-remote`, which needs
 * no API token and no rate limit; versions come from the registries' public
 * indexes. The catalogue projects themselves are only read, never changed.
 */

function git(args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], { stderr: 'pipe' });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

async function json(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'purview-dev-website' } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function latestVersion(registry: string, id: string): Promise<string | null> {
  if (registry === 'npm') {
    const document = (await json(`https://registry.npmjs.org/${id}`)) as {
      'dist-tags'?: Record<string, string>;
    } | null;
    const tags = document?.['dist-tags'];
    return tags ? JSON.stringify(Object.entries(tags).toSorted()) : null;
  }
  const index = (await json(
    `https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`,
  )) as { versions?: string[] } | null;
  return index?.versions?.at(-1) ?? null;
}

async function projectState(
  repository: string,
  packages: { id: string; registry: string }[],
): Promise<UpstreamProjectState> {
  const url = `https://github.com/${repository}.git`;
  const head = git(['ls-remote', url, 'HEAD']);
  const tags = git(['ls-remote', '--tags', '--refs', url]);
  const tagDigest =
    tags === null
      ? null
      : new Bun.CryptoHasher('sha256')
          .update(
            [...parseLsRemote(tags)]
              .map(([ref, sha]) => `${ref} ${sha}`)
              .toSorted()
              .join('\n'),
          )
          .digest('hex')
          .slice(0, 16);
  const versions: Record<string, string | null> = {};
  for (const pkg of packages) {
    versions[`${pkg.registry}:${pkg.id}`] = await latestVersion(pkg.registry, pkg.id);
  }
  return {
    repository,
    head: head === null ? null : (parseLsRemote(head).get('HEAD') ?? null),
    tags: tagDigest,
    packages: versions,
  };
}

async function currentState(): Promise<UpstreamState> {
  const projects: UpstreamState['projects'] = {};
  for (const project of loadProjects()) {
    if (project.status === 'archived') {
      continue;
    }
    projects[project.id] = await projectState(project.repository, project.packages);
    const state = projects[project.id];
    const unknown = [
      state?.head === null ? 'head' : null,
      state?.tags === null ? 'tags' : null,
      ...Object.entries(state?.packages ?? {})
        .filter(([, version]) => version === null)
        .map(([pkg]) => pkg),
    ].filter(Boolean);
    if (unknown.length > 0) {
      console.warn(`  ${project.id}: could not read ${unknown.join(', ')}`);
    }
  }
  return { schema: UPSTREAM_STATE_SCHEMA, generatedAt: new Date().toISOString(), projects };
}

function setOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function run(): Promise<number> {
  const args = process.argv.slice(2);
  const writeTo = args[args.indexOf('--write') + 1];
  const compareWith = args[args.indexOf('--compare') + 1];

  if (args.includes('--write') && writeTo) {
    const state = await currentState();
    const target = resolve(writeTo);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    console.log(
      `Upstream state for ${Object.keys(state.projects).length} project(s) written to ${writeTo}.`,
    );
    return 0;
  }

  if (args.includes('--compare') && compareWith) {
    const previous = readUpstreamState(await json(compareWith));
    const changes = upstreamChanges(previous, await currentState());
    if (changes.length === 0) {
      console.log('Upstream unchanged since the deployed build; nothing to rebuild.');
    } else {
      console.log(`Upstream changed (${changes.length}):`);
      for (const change of changes) {
        console.log(`  ${change}`);
      }
    }
    setOutput('changed', changes.length > 0 ? 'true' : 'false');
    return 0;
  }

  console.error('Usage: upstream-state --write <file> | --compare <url>');
  return 2;
}

process.exit(await run());
