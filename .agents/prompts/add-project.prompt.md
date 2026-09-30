---
mode: agent
description: Add a repository to the Purview-Dev website catalogue and integrate it end-to-end.
---

# Add a project to the catalogue

Inputs (fill in before running):

- Repository: `<owner>/<repo>` (required)
- Owned by purview-dev? `yes` (catalogue project) / `no` (collaboration)
- Category (optional — let the recon decide): `<category>`
- Status (optional — let the release channel decide): `stable | preview | archived`
- Notes: anything known about docs location, package ids, or the story to tell

## Instructions

Load and follow these skills, in order:

1. `.agents/skills/add-catalogue-project/SKILL.md` — the end-to-end procedure.
2. `.agents/skills/project-manifest-reference/SKILL.md` — fields and rules.
3. `.agents/skills/docs-aggregation-rules/SKILL.md` — the `docs` configuration.
4. `.agents/skills/use-case-authoring/SKILL.md` — the use cases.
5. `.agents/skills/github-repo-metadata/SKILL.md` — topics and stability signals.
6. `.agents/skills/site-validation-loop/SKILL.md` — the checks to run.

Use the `catalogue-onboarder` agent if it is available.

## Deliverables

1. Recon evidence: repository metadata, docs tree/landing page, package ids and channels, release
   channel. Show the commands and their output.
2. The `projects.yml` record (or `externalProjects` record) added at an unused `order`, with `docs`,
   `packages`, `targetFrameworks`, `install` (only when not plain NuGet), relationships and
   acknowledgments where they genuinely apply.
3. At least one concrete use case with `code` + `language`, an `evidence` fact, and a `docsPage` that
   resolves.
4. Repository topic fixes where tags are missing or poor.
5. Validation output: `just data-sync`, `just check-projects`, `bun run typecheck`, `bun run test`,
   `just check-generated`, `just validate`.

## Constraints

- Do not fabricate documentation pages, use-case evidence, or release data.
- Do not invent schema values; use only the vocabularies in `project-manifest-reference`.
- Do not hand-edit `src/src/content/docs/**`, `src/.cache/**`, or `src/dist/**`.
- Do not bump the root `package.json` version.
- Finish with a short report: record added, docs page count, tag/topic changes, checks run, and
  outstanding `upstream` follow-ups.
