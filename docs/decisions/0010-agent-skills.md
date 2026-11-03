# 0010 — Agent Skills on the portal

- **Status:** Accepted
- **Date:** 2026-03-11
- **Supersedes:** none

## Context

Purview projects publish Agent Skills: guidance an AI coding agent loads on
demand. The ecosystem already agrees on the shape (the engineering playbook's
*Agent Skills Distribution* records it):

- a skill is authored **once**, at `skills/<name>/SKILL.md` in the repository
  that owns the knowledge, with optional `references/`, `templates/` and peer
  files beside it;
- it reaches consumers by **one** route — the skills CLI
  (`npx skills add <owner>/<repo>`), which clones the repository, writes into
  each agent's own directories (`-a <agent>`, `-g` for user level) and records
  what it installed in `skills-lock.json`;
- nothing packs a skill into a NuGet package, and no build mirrors skills into
  an agent directory.

The portal had no skills story at all. `pm-skills` is a pure skills project whose
project page shows only its README, and several product projects author skills of
their own (`aspire-resourcekit`, `results`, …) without the site saying so. A
reader therefore met two different answers ("install the package" on one page,
nothing on another) and could not read a skill without cloning its repository.

## Decision

1. **The catalogue declares the skills a project publishes.** `skills[].name`
   (a slug) and an optional `path` (default `skills/<name>`) name the directory;
   `description` may override the skill's own front matter. Names are unique per
   project and validated by the loader.
2. **The build mirrors every declared skill to purview.dev.**
   `just data-sync` reads the repository tree, copies the whole skill directory
   to `public/skills/<project>/<skill>/…` and caches it under `.cache/skills/`,
   so `https://purview.dev/skills/<project>/<skill>/SKILL.md` (and its
   references) is a real, stable URL. `public/skills/` is generated and
   gitignored like `public/schemas/`. A skill's description is read from its own
   YAML front matter — inline or a folded block scalar (`description: >-`) — so
   what the site shows is what the CLI shows.
3. **One shared instruction block, everywhere.** A single component
   (`components/SkillInstall.astro`) renders the install commands, the `#<ref>`
   pinning syntax and the `skills-lock.json` restore note. Every command is an
   Expressive Code block (so it carries the copy button), and every package
   manager a reader may use is offered — `npx`, `bunx`, `pnpm dlx`, `yarn dlx` —
   rather than telling a bun or pnpm user to reach for npm. The component is used
   unchanged on each project page that declares skills and in `/skills.json`, so
   the instructions cannot drift.
4. **Skills are presented in project context.** Each project page lists the
   skills that project authors, with the description from each `SKILL.md` and a
   direct link to the file; the catalogue cards show how many skills a project
   has. `/skills.json` remains the machine-readable index (name, description,
   directory, entry URL, file list, install commands per package manager), and
   `/skills/` redirects to `/projects/` — a site-wide list separated a skill from
   the project that gives it meaning.
5. **Guards, not hopes.** `just check-projects` fails when a declared skill has
   no mirror, `just check-generated` fails when a declared skill is missing from
   the built site, and the sync fails when a declared skill resolves to no files
   at its repository path.

## Consequences

- `pm-skills` gains its own declarations; `aspire-resourcekit` and `results` gain
  five each, so the same install block now appears on each of their project pages
  with its own repository.
- The site never claims to *host* the CLI source: it serves the skill files. The
  CLI still installs from the git repository, which is what records a pinnable
  ref; the portal URLs exist so a skill can be read, reviewed or fetched without
  a clone.
- `public/skills/**` is generated output. Editing it is as wrong as editing the
  docs mirror; `just data-sync` owns it and `just clean` removes it.
- A new skill is a manifest entry plus the repository directory. A skill that
  moves breaks the build until the manifest follows, which is the intended
  failure mode.
