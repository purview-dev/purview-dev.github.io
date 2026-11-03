import type { ResolvedProject } from '../src/lib/manifest/load';
import type { DataMode } from './sync-assets';

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fetchRawFile, listRepositoryFiles } from '../src/lib/docs/aggregate';
import { resolveDocChannels } from '../src/lib/docs/channels';
import { loadProjects } from '../src/lib/manifest/load';
import { getReleaseIndex } from '../src/lib/releases/runtime';
import { declaresSkills, skillSourcePath, SKILLS_PUBLIC_DIR } from '../src/lib/skills';

/**
 * Mirror the Agent Skills each project publishes (ADR 0010).
 *
 * The skill set and its contents are read from the project's **documentation
 * ref** — the live release tag when there is a live channel, otherwise the
 * prerelease ref — so the skills on purview.dev always match the release the
 * documentation describes. The catalogue only says "this project publishes
 * skills" (`skills: true`); the list is discovered on every build, which is why
 * a new skill needs no site change.
 */
export const SKILLS_CACHE_DIR = resolve('.cache/skills');

export interface SkillTarget {
  projectId: string;
  repository: string;
  name: string;
  sourcePath: string;
  ref: string;
}

/** Declared and/or discovered skills for one project at a given ref. */
export function discoverSkills(
  project: ResolvedProject,
  tree: string[],
  ref: string,
): SkillTarget[] {
  const targets = new Map<string, SkillTarget>();
  const add = (name: string, sourcePath: string): void => {
    targets.set(name, {
      projectId: project.id,
      repository: project.repository,
      name,
      sourcePath: sourcePath.replace(/\/+$/, ''),
      ref,
    });
  };
  if (project.discoverSkills) {
    for (const path of tree) {
      const match = /^skills\/([a-z0-9-]+)\/SKILL\.md$/.exec(path);
      if (match?.[1]) {
        add(match[1], `skills/${match[1]}`);
      }
    }
  }
  for (const skill of project.skills) {
    add(skill.name, skillSourcePath(skill));
  }
  return [...targets.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

function write(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Relative paths of every file inside a directory, recursively. */
function listFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...listFiles(join(directory, entry.name), `${prefix}${entry.name}/`));
      continue;
    }
    files.push(`${prefix}${entry.name}`);
  }
  return files;
}

function publishCached(cache: string, target: string): string[] {
  if (!existsSync(cache)) {
    return [];
  }
  const files = listFiles(cache);
  for (const path of files) {
    write(join(target, ...path.split('/')), readFileSync(join(cache, ...path.split('/')), 'utf8'));
  }
  return files;
}

async function fetchAndPublish(skill: SkillTarget, tree: string[]): Promise<string[]> {
  const written: string[] = [];
  const cache = resolve(SKILLS_CACHE_DIR, skill.projectId, skill.name);
  const target = resolve(SKILLS_PUBLIC_DIR, skill.projectId, skill.name);
  for (const path of tree.filter((entry) => entry.startsWith(`${skill.sourcePath}/`))) {
    const raw = await fetchRawFile(skill.repository, skill.ref, path);
    if (!raw) {
      continue;
    }
    const relativePath = path.slice(skill.sourcePath.length + 1);
    write(join(cache, ...relativePath.split('/')), raw.content);
    write(join(target, ...relativePath.split('/')), raw.content);
    written.push(relativePath);
  }
  return written;
}

/**
 * Mirror every project's skills. The cache records the ref it was fetched from,
 * so a new release invalidates it automatically; `live` always re-reads.
 */
export async function syncSkills(mode: DataMode): Promise<number> {
  const releaseData = getReleaseIndex().data;
  const projects = loadProjects().filter(
    (project) => project.status !== 'archived' && declaresSkills(project),
  );
  if (projects.length === 0) {
    console.log('Skills: none declared.');
    return 0;
  }

  rmSync(SKILLS_PUBLIC_DIR, { recursive: true, force: true });
  let mirrored = 0;
  for (const project of projects) {
    const channel = resolveDocChannels(project, releaseData).channels[0];
    const ref = channel?.ref ?? 'main';
    const tree = await listRepositoryFiles(project.repository, ref);

    for (const skill of discoverSkills(project, tree, ref)) {
      const cache = resolve(SKILLS_CACHE_DIR, project.id, skill.name);
      const marker = resolve(SKILLS_CACHE_DIR, project.id, `${skill.name}.ref`);
      const cached = existsSync(marker) && readFileSync(marker, 'utf8').trim() === ref;
      const target = resolve(SKILLS_PUBLIC_DIR, project.id, skill.name);

      let files: string[];
      if (mode !== 'live' && cached) {
        files = publishCached(cache, target);
      } else if (mode === 'cache' || mode === 'fixture') {
        throw new Error(
          `Skill ${project.id}/${skill.name} is not cached for ref "${ref}". ` +
            'Run `just live-data-sync` once so it can be fetched.',
        );
      } else {
        files = await fetchAndPublish(skill, tree);
      }

      if (files.length === 0) {
        throw new Error(
          `Skill not found: ${skill.repository}/${skill.sourcePath}@${ref} ` +
            `(project "${project.id}"). Publish the skill at that path or correct the manifest.`,
        );
      }
      write(marker, ref);
      mirrored += 1;
      console.log(`  skill ${project.id}/${skill.name}@${ref}: ${files.length} file(s)`);
    }
  }
  console.log(`Skills mirrored: ${mirrored} skill(s).`);
  return mirrored;
}

if (import.meta.main) {
  const requested = (process.env.DATA_MODE ?? 'auto').toLowerCase();
  const mode: DataMode = ['auto', 'live', 'cache', 'fixture'].includes(requested)
    ? (requested as DataMode)
    : 'auto';
  await syncSkills(mode);
}
