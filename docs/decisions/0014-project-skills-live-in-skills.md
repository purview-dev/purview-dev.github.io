# ADR 0014 — Project skills live in `skills/`

- Status: accepted
- Date: 2026-11-15

## Context

The skills CLI installs into `.agents/skills/`, its "universal" location, and `npx skills add
<owner>/<repo>` reads a repository's *published* skills. When a repository commits `.agents/skills/`,
the skills it installed for its own agents — someone else's guidance — become discoverable as though
the repository had written them, and the CLI's next update fights the committed copy. `.claude/` and
every other per-agent folder are the same problem one level down: a local copy that drifts from
`skills-lock.json` the moment the CLI updates it.

## Decisions

1. `skills/<name>/SKILL.md` is the only location for the skills a repository authors and publishes.
2. `.agents/skills/` is a local install: gitignored, never tracked, and reproducible from the
   committed `skills-lock.json` with `just skills-install` (the SDK's `InstallPurviewSkills` target).
3. `.claude/` (and every other per-agent folder) is gitignored with it.
4. The catalogue-maintenance skills this repository used to keep in `.agents/skills/` moved to
   `skills/`, with every pointer to them updated. `.agents/agents/` and `.agents/prompts/` stay where
   they are: they are authored content and neither is something the CLI writes.
5. A repository holds the line with a test rather than a convention: nothing under `.agents/skills/`
   may be tracked, and both ignore rules must be in place. The .NET repositories assert this in
   `InstalledSkillTests`, and `purview-dev/build-sdk` asserts it in `RepositorySkillsSelfTests` and
   documents it in the `purview-buildsdk-skills-layout` skill.

## Consequences

- `npx skills add purview-dev/<repo>` finds only the skills that repository publishes.
- A fresh clone has no `.agents/skills/` until `just skills-install` runs; the checks that compare an
  install with the record are vacuous before that and strict afterwards.
- `skills-lock.json` stays committed — it is the record of what to install, and the only part of the
  install that belongs in git.
- Two skills that were deliberately local become part of their repositories' published sets when they
  move: `purview-buildsdk-settings-docs-sync` (build-sdk) and `purview-telemetry-benchmarks`
  (telemetry-sourcegenerator), and this repository's eight catalogue skills.
