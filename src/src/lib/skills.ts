import type { ProjectSkill } from './manifest/schema';

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Agent Skills (ADR 0010).
 *
 * Every Purview project that authors skills does so at `skills/<name>/SKILL.md`
 * in its own repository, and the skills CLI is the only delivery route — no
 * package ships them and no build writes into an agent directory. The site
 * mirrors each declared skill to stable `purview.dev` URLs so the skills can be
 * fetched directly, and shows the **same** install instructions wherever skills
 * appear (pm-skills today, plus every product project that authors its own).
 */
export const SKILLS_PUBLIC_DIR = resolve('public/skills');

/** Site path of a project's mirrored skills: `/skills/<project>/`. */
export function skillsProjectPath(projectId: string): string {
  return `/skills/${projectId}/`;
}

/** Site path of one mirrored skill directory: `/skills/<project>/<skill>/`. */
export function skillSitePath(projectId: string, name: string): string {
  return `/skills/${projectId}/${name}/`;
}

/** Site URL of a skill's entry point (`SKILL.md`). */
export function skillEntryPath(projectId: string, name: string): string {
  return `${skillSitePath(projectId, name)}SKILL.md`;
}

/** Repository directory of a declared skill; the convention is `skills/<name>`. */
export function skillSourcePath(skill: ProjectSkill): string {
  return (skill.path ?? `skills/${skill.name}`).replace(/^\/+|\/+$/g, '');
}

/**
 * The canonical install command. Every page that offers skills prints exactly
 * this line, so a reader never has to reconcile two sets of instructions.
 */
export function skillsInstallCommand(repository: string): string {
  return `npx skills add ${repository}`;
}

/** The same command pinned to a git ref, for repositories that need a fixed version. */
export function skillsPinnedInstallCommand(repository: string, ref: string): string {
  return `npx skills add ${repository}#${ref}`;
}

export interface MirroredSkillFile {
  /** Path relative to the skill directory (`SKILL.md`, `references/x.md`). */
  path: string;
  size: number;
}

/** Every file mirrored for a skill, sorted by path. Empty when it was not synced. */
export function listMirroredSkillFiles(
  projectId: string,
  name: string,
  root = SKILLS_PUBLIC_DIR,
): MirroredSkillFile[] {
  const directory = join(root, projectId, name);
  if (!existsSync(directory)) {
    return [];
  }
  const files: MirroredSkillFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      files.push({
        path: relative(directory, path).split('\\').join('/'),
        size: statSync(path).size,
      });
    }
  };
  walk(directory);
  return files.toSorted((a, b) => a.path.localeCompare(b.path));
}

export interface MirroredSkill {
  name: string;
  description: string | null;
  files: MirroredSkillFile[];
}

/**
 * The skills actually mirrored for a project — which is the published list, not
 * the manifest text. `just data-sync` discovers them from the project's own
 * documentation ref (the live tag when there is a live channel), so the site can
 * never advertise a skill set that is older than the release it documents.
 */
export function listMirroredSkills(projectId: string, root = SKILLS_PUBLIC_DIR): MirroredSkill[] {
  const directory = join(root, projectId);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      description: readSkillDescription(projectId, entry.name, root),
      files: listMirroredSkillFiles(projectId, entry.name, root),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** True when the catalogue says this project publishes skills. */
export function declaresSkills(project: {
  discoverSkills: boolean;
  skills: { name: string }[];
}): boolean {
  return project.discoverSkills || project.skills.length > 0;
}

/**
 * The skill's own `description:` front matter, which is what the CLI shows and
 * what the project catalogue uses when it does not override it.
 */
export function readSkillDescription(
  projectId: string,
  name: string,
  root = SKILLS_PUBLIC_DIR,
): string | null {
  const file = join(root, projectId, name, 'SKILL.md');
  if (!existsSync(file)) {
    return null;
  }
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  const description = match?.[1] ? /^description:\s*(.+)$/m.exec(match[1])?.[1] : undefined;
  return description ? description.trim().replace(/^["']|["']$/g, '') : null;
}
