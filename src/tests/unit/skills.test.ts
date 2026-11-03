import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverSkills } from '../../scripts/sync-skills';
import { manifestSchema } from '../../src/lib/manifest/schema';
import {
  listMirroredSkillFiles,
  readSkillDescription,
  skillEntryPath,
  skillSitePath,
  skillSourcePath,
  skillsInstallCommand,
  skillsInstallCommands,
  skillsPinnedInstallCommand,
  skillsProjectPath,
} from '../../src/lib/skills';

const PROJECT = 'pm-skills';
const REPOSITORY = 'purview-dev/pm-skills';

describe('skill paths and commands', () => {
  test('skills follow the repository convention and mirror to stable site paths', () => {
    expect(skillSourcePath({ name: 'pm-park' })).toBe('skills/pm-park');
    expect(skillSourcePath({ name: 'pm-park', path: 'custom/park/' })).toBe('custom/park');
    expect(skillsProjectPath(PROJECT)).toBe('/skills/pm-skills/');
    expect(skillSitePath(PROJECT, 'pm-park')).toBe('/skills/pm-skills/pm-park/');
    expect(skillEntryPath(PROJECT, 'pm-park')).toBe('/skills/pm-skills/pm-park/SKILL.md');
  });

  test('the install story is one command with an optional pin', () => {
    expect(skillsInstallCommand(REPOSITORY)).toBe('npx skills add purview-dev/pm-skills');
    expect(skillsPinnedInstallCommand(REPOSITORY, 'v4.0.0')).toBe(
      'npx skills add purview-dev/pm-skills#v4.0.0',
    );
  });

  test('every package manager gets the same CLI, pinning and restore story', () => {
    const commands = skillsInstallCommands(REPOSITORY);
    expect(commands.map((entry) => entry.id)).toEqual(['npm', 'bun', 'pnpm', 'yarn']);
    expect(commands.map((entry) => entry.command)).toEqual([
      'npx skills add purview-dev/pm-skills',
      'bunx skills add purview-dev/pm-skills',
      'pnpm dlx skills add purview-dev/pm-skills',
      'yarn dlx skills add purview-dev/pm-skills',
    ]);
    expect(commands.map((entry) => entry.restore)).toEqual([
      'npx skills experimental_install',
      'bunx skills experimental_install',
      'pnpm dlx skills experimental_install',
      'yarn dlx skills experimental_install',
    ]);
    expect(commands[1]?.pinned).toBe('bunx skills add purview-dev/pm-skills#<ref>');
  });
});

describe('mirrored skill files', () => {
  test('lists every file in the skill directory and reads its description', () => {
    const root = mkdtempSync(join(tmpdir(), 'purview-skills-'));
    try {
      const directory = join(root, PROJECT, 'pm-park');
      mkdirSync(join(directory, 'references'), { recursive: true });
      writeFileSync(
        join(directory, 'SKILL.md'),
        '---\nname: pm-park\ndescription: Capture an idea in one line.\n---\n\n# Park\n',
        'utf8',
      );
      writeFileSync(join(directory, 'references', 'format.md'), '# Format\n', 'utf8');

      expect(
        listMirroredSkillFiles(PROJECT, 'pm-park', root)
          .map((file) => file.path)
          .toSorted(),
      ).toEqual(['SKILL.md', 'references/format.md']);
      expect(readSkillDescription(PROJECT, 'pm-park', root)).toBe('Capture an idea in one line.');
      expect(listMirroredSkillFiles(PROJECT, 'missing', root)).toEqual([]);
      expect(readSkillDescription(PROJECT, 'missing', root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a folded YAML description is read as prose, not as the `>-` marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'purview-skills-'));
    try {
      const directory = join(root, PROJECT, 'pm-fold');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'SKILL.md'),
        [
          '---',
          'name: pm-fold',
          'description: >-',
          '  Use when a session ends, the context is about to be compacted,',
          '  or the user says pause.',
          '---',
          '',
          '# Fold',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(readSkillDescription(PROJECT, 'pm-fold', root)).toBe(
        'Use when a session ends, the context is about to be compacted, or the user says pause.',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('skills discovery', () => {
  test('discovers every skills/<name>/SKILL.md at the project ref', () => {
    const project = {
      id: PROJECT,
      repository: REPOSITORY,
      discoverSkills: true,
      skills: [],
    } as unknown as Parameters<typeof discoverSkills>[0];
    const tree = [
      'skills/pm-park/SKILL.md',
      'skills/pm-park/references/format.md',
      'skills/pm-shape/SKILL.md',
      'skills/notes/README.md',
      'docs/wiki/Getting-Started.md',
    ];
    const found = discoverSkills(project, tree, 'v4.0.0');
    expect(found.map((skill) => `${skill.name}@${skill.ref}`)).toEqual([
      'pm-park@v4.0.0',
      'pm-shape@v4.0.0',
    ]);
    // Whole directory travels with the skill, not just SKILL.md.
    expect(found[0]?.sourcePath).toBe('skills/pm-park');
  });

  test('keeps explicit declarations alongside discovery', () => {
    const project = {
      id: PROJECT,
      repository: REPOSITORY,
      discoverSkills: false,
      skills: [{ name: 'pm-purview', path: 'custom/purview' }],
    } as unknown as Parameters<typeof discoverSkills>[0];
    expect(discoverSkills(project, [], 'main')).toEqual([
      {
        projectId: PROJECT,
        repository: REPOSITORY,
        name: 'pm-purview',
        sourcePath: 'custom/purview',
        ref: 'main',
      },
    ]);
  });
});

describe('skills in the manifest', () => {
  const base = {
    id: PROJECT,
    name: 'PM Skills',
    shortDescription: 'Project-management skills.',
    description: 'Project-management skills for coding agents.',
    origin: 'Ideas were being lost.',
    useWhen: 'You drive a project with an agent.',
    avoidWhen: 'You want a hosted planning tool.',
    repository: REPOSITORY,
    category: 'developer-tooling',
    status: 'stable',
  };

  test('accepts declared skills with an optional path override', () => {
    const parsed = manifestSchema.safeParse({
      projects: [
        {
          ...base,
          skills: [{ name: 'pm-park' }, { name: 'pm-shape', path: 'skills/pm-shape' }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects a repeated skill name and a non-slug name', () => {
    const duplicate = manifestSchema.safeParse({
      projects: [{ ...base, skills: [{ name: 'pm-park' }, { name: 'pm-park' }] }],
    });
    expect(duplicate.success).toBe(false);

    const invalid = manifestSchema.safeParse({
      projects: [{ ...base, skills: [{ name: 'PM Park' }] }],
    });
    expect(invalid.success).toBe(false);
  });
});
