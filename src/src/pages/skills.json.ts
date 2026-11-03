import type { APIRoute } from 'astro';

import { loadProjects } from '~/lib/manifest/load';
import {
  listMirroredSkills,
  skillEntryPath,
  skillsInstallCommand,
  skillSitePath,
} from '~/lib/skills';
import { absoluteUrl } from '~/lib/urls';

/**
 * Machine-readable index of every published Agent Skill (ADR 0010), following
 * the same idea as `/discover.json`: one document that names each skill, the
 * exact install command, and the purview.dev URL that serves it.
 */
export const GET: APIRoute = () => {
  const projects = loadProjects()
    .filter((project) => listMirroredSkills(project.id).length > 0 && project.status !== 'archived')
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const manifest = {
    schema: 1,
    projects: projects.map((project) => {
      const command = skillsInstallCommand(project.repository);
      return {
        id: project.id,
        name: project.name,
        repository: project.repository,
        install: {
          command,
          pinned: `${command}#<ref>`,
          restore: 'npx skills experimental_install',
        },
        skills: listMirroredSkills(project.id).map((skill) => ({
          name: skill.name,
          description: skill.description,
          directory: absoluteUrl(skillSitePath(project.id, skill.name)),
          url: absoluteUrl(skillEntryPath(project.id, skill.name)),
          files: skill.files.map((file) => file.path),
        })),
      };
    }),
  };

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
