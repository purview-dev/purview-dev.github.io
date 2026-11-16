import type { ResolvedProject } from '../src/lib/manifest/load';
import type { DataMode } from './sync-assets';

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { mapWithConcurrency } from '../src/lib/concurrency';
import { fetchRawFileContent, listRepositoryFiles } from '../src/lib/docs/aggregate';
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
 * a new skill needs no site change. Modes that promise no network (`cache`,
 * `fixture`) read the cached skill set instead — see `planSkills`.
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

/** How many skill files the mirror fetches at once; a live sync is otherwise latency-bound. */
const SKILL_FETCH_CONCURRENCY = 8;

/** A skill the mirror has to place, and the work placing it needs. */
interface PlannedSkill {
  skill: SkillTarget;
  /** Where the skill is cached, served from, and marked as fetched. */
  cache: string;
  target: string;
  marker: string;
  /** Relative paths copied out of an up-to-date cache; null when the skill is re-read. */
  cachedFiles: string[] | null;
  /** Repository paths to fetch for a skill the cache cannot serve. */
  sources: string[];
  /** Relative paths written from `sources`, in the order they were fetched. */
  files: string[];
}

/** One repository file to fetch for one planned skill. */
interface SkillSource {
  plan: PlannedSkill;
  path: string;
  relativePath: string;
}

/**
 * Records the ref a project's skills were last synced for. A skill name is a
 * lowercase slug, so a leading dot cannot collide with one — and it is a file,
 * not a directory, so the cached-skill scan ignores it.
 */
const PROJECT_REF_FILE = '.ref';

/**
 * The skills a project's cache holds for a ref.
 *
 * `cache` and `fixture` promise a sync that touches no network, so in those
 * modes the cache — not the remote tree — says which skills exist. The `.ref`
 * marker written beside each cached skill names the ref it was fetched from, so
 * an entry fetched for one release is not offered for another. A stray file or
 * directory beside them is not a skill.
 *
 * `root` is injectable so the resolution is testable against a temp directory.
 */
export function cachedSkills(
  project: ResolvedProject,
  ref: string,
  root = SKILLS_CACHE_DIR,
): SkillTarget[] {
  const directory = resolve(root, project.id);
  if (!existsSync(directory)) {
    return [];
  }
  const targets: SkillTarget[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const marker = resolve(directory, `${entry.name}.ref`);
    if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== ref) {
      continue;
    }
    targets.push({
      projectId: project.id,
      repository: project.repository,
      name: entry.name,
      sourcePath: skillSourcePath({ name: entry.name }),
      ref,
    });
  }
  return targets.toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The ref a project's skills were last synced for, or null when the cache has
 * never held them. A project that publishes no skills has nothing in the cache
 * either, so this is what tells "no skills" apart from "never fetched".
 */
export function cachedSkillsRef(project: ResolvedProject, root = SKILLS_CACHE_DIR): string | null {
  const marker = resolve(root, project.id, PROJECT_REF_FILE);
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
}

/**
 * The skills to mirror for one project: the tree's when it is in hand, the
 * cache's when the mode forbids a request.
 *
 * The tree is authoritative whenever it is available — `skills: true` means
 * "publish every skill under `skills/`", so a skill added upstream appears with
 * no site change. Without a tree the catalogue's declaration has to be satisfied
 * by the cache, and a cache that was never synced for this ref, or that is
 * missing a declared skill, is an error rather than a silent omission.
 */
function skillsForRef(project: ResolvedProject, ref: string, tree: string[] | null): SkillTarget[] {
  if (tree) {
    return discoverSkills(project, tree, ref);
  }

  const syncedRef = cachedSkillsRef(project);
  if (syncedRef !== ref) {
    throw new Error(
      `Skills for "${project.id}" have not been synced for ref "${ref}"` +
        (syncedRef === null ? '' : ` (the cache holds "${syncedRef}")`) +
        '. Run `just live-data-sync` once so they can be fetched.',
    );
  }

  const cached = new Map(cachedSkills(project, ref).map((skill) => [skill.name, skill]));
  for (const skill of project.skills) {
    if (!cached.has(skill.name)) {
      throw new Error(
        `Skill ${project.id}/${skill.name} is not cached for ref "${ref}". ` +
          'Run `just live-data-sync` once so it can be fetched.',
      );
    }
    cached.set(skill.name, {
      projectId: project.id,
      repository: project.repository,
      name: skill.name,
      sourcePath: skillSourcePath(skill),
      ref,
    });
  }
  return [...cached.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Plan every skill the catalogue declares: the ref it is read at, whether the
 * cache can serve it, and — when it cannot — which files have to be fetched.
 *
 * Planning is also what decides whether the repository tree is needed at all,
 * which is the difference between a sync that costs one request per project and
 * one that costs none: a project whose declared skills are all cached and that
 * asks for no discovery has nothing to look up.
 */
async function planSkills(
  projects: readonly ResolvedProject[],
  mode: DataMode,
): Promise<PlannedSkill[]> {
  const releaseData = getReleaseIndex().data;
  const plans: PlannedSkill[] = [];

  for (const project of projects) {
    const channel = resolveDocChannels(project, releaseData).channels[0];
    const ref = channel?.ref ?? 'main';
    const cachedRef = (name: string): string | null => {
      const marker = resolve(SKILLS_CACHE_DIR, project.id, `${name}.ref`);
      return existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
    };
    const missing = project.skills.find((skill) => cachedRef(skill.name) !== ref)?.name ?? null;

    let tree: string[] | null;
    if (mode === 'cache' || mode === 'fixture') {
      tree = null; // this mode never makes a request
    } else if (mode === 'auto' && !project.discoverSkills && missing === null) {
      tree = []; // nothing to fetch and nothing to discover, so nothing to list
    } else {
      tree = await listRepositoryFiles(project.repository, ref);
    }
    if (tree) {
      // The project-level marker is what lets a later offline sync tell "this
      // ref publishes no skills" from "these skills were never fetched".
      write(resolve(SKILLS_CACHE_DIR, project.id, PROJECT_REF_FILE), ref);
    }

    for (const skill of skillsForRef(project, ref, tree)) {
      const cached = mode !== 'live' && cachedRef(skill.name) === ref;
      const cache = resolve(SKILLS_CACHE_DIR, project.id, skill.name);
      const target = resolve(SKILLS_PUBLIC_DIR, project.id, skill.name);
      plans.push({
        skill,
        cache,
        target,
        marker: resolve(SKILLS_CACHE_DIR, project.id, `${skill.name}.ref`),
        cachedFiles: cached ? publishCached(cache, target) : null,
        sources: cached
          ? []
          : (tree ?? []).filter((path) => path.startsWith(`${skill.sourcePath}/`)),
        files: [],
      });
    }
  }

  return plans;
}

/**
 * Mirror every project's skills. The cache records the ref it was fetched from,
 * so a new release invalidates it automatically; `live` always re-reads.
 *
 * The files are fetched eight at a time (`mapWithConcurrency`) because a live
 * sync would otherwise be one round trip per file per skill, but everything
 * observable is written in plan order — the content of `public/skills`, the
 * markers and the report — so the result is identical to the serial version and
 * reproducible run to run.
 */
export async function syncSkills(mode: DataMode): Promise<number> {
  const projects = loadProjects().filter(
    (project) => project.status !== 'archived' && declaresSkills(project),
  );
  if (projects.length === 0) {
    console.log('Skills: none declared.');
    return 0;
  }

  rmSync(SKILLS_PUBLIC_DIR, { recursive: true, force: true });
  const plans = await planSkills(projects, mode);

  const sources: SkillSource[] = plans.flatMap((plan) =>
    plan.sources.map((path) => ({
      plan,
      path,
      relativePath: path.slice(plan.skill.sourcePath.length + 1),
    })),
  );
  const contents = await mapWithConcurrency(sources, SKILL_FETCH_CONCURRENCY, (source) =>
    fetchRawFileContent(source.plan.skill.repository, source.plan.skill.ref, source.path),
  );
  sources.forEach((source, index) => {
    const content = contents[index];
    if (typeof content !== 'string') {
      return;
    }
    write(join(source.plan.cache, ...source.relativePath.split('/')), content);
    write(join(source.plan.target, ...source.relativePath.split('/')), content);
    source.plan.files.push(source.relativePath);
  });

  let mirrored = 0;
  for (const plan of plans) {
    const files = plan.cachedFiles ?? plan.files;
    if (files.length === 0) {
      throw new Error(
        `Skill not found: ${plan.skill.repository}/${plan.skill.sourcePath}@${plan.skill.ref} ` +
          `(project "${plan.skill.projectId}"). Publish the skill at that path or correct the manifest.`,
      );
    }
    write(plan.marker, plan.skill.ref);
    mirrored += 1;
    console.log(
      `  skill ${plan.skill.projectId}/${plan.skill.name}@${plan.skill.ref}: ${files.length} file(s)`,
    );
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
