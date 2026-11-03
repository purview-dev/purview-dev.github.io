import type { APIRoute } from 'astro';

import { loadProjects } from '~/lib/manifest/load';
import {
  listMirroredSkills,
  skillEntryPath,
  skillsInstallCommands,
  skillSitePath,
} from '~/lib/skills';
import { absoluteUrl } from '~/lib/urls';

/**
 * Machine-readable index of every published Agent Skill (ADR 0010), following
 * the same idea as `/discover.json`: one document that names each skill, the
 * exact install command (per package manager), and the purview.dev URL that
 * serves it.
 */
export const GET: APIRoute = () => {
  const projects = loadProjects()
    .filter((project) => listMirroredSkills(project.id).length > 0 && project.status !== 'archived')
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const manifest = {
    schema: 2,
    projects: projects.map((project) => {
      const commands = skillsInstallCommands(project.repository);
      const defaultCommand = commands[0]!;
      return {
        id: project.id,
        name: project.name,
        repository: project.repository,
        install: {
          // The npm form keeps the historical top-level fields for consumers
          // that predate the multi-runner commands array.
          command: defaultCommand.command,
          pinned: defaultCommand.pinned,
          restore: defaultCommand.restore,
          commands: commands.map(({ id, label, command, pinned, restore }) => ({
            id,
            label,
            command,
            pinned,
            restore,
          })),
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
