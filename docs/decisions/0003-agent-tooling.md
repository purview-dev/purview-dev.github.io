# ADR 0003 — Agent tooling for the catalogue: agents, skills, and a deterministic guard

- Status: accepted
- Date: 2026-09-30

## Context

Adding a project to the website touches several coupled surfaces: a typed manifest record
(`src/src/data/projects.yml`), a documentation source configuration aggregated at build time,
NuGet package declarations that drive install snippets and release tables, GitHub repository topics
that provide the site's tag chips, and concrete audience-tagged use cases. The catalogue also has
implicit invariants that are easy to break by hand — for example the display `name` of a documented
project must slugify to its `id`, because `starlight-llms-txt` derives the per-project bundle path
from the project name while the UI links `/_llms-txt/<id>.txt`.

Two tasks recur and were previously tribal knowledge:

1. Add a repository (`purview-dev/<repo>`, or a collaboration repository) and integrate it
   completely.
2. Prove that every project already in the catalogue is correct — documentation, stability,
   metadata, relationships.

The organisation already has an agent-tooling convention in the .NET repositories
(`purview-dev/build`, `purview-dev/build-sdk`, `purview-dev/aspire-resourcekit`): a root `AGENTS.md`,
`.agents/agents/*.agent.md`, `.agents/skills/<name>/SKILL.md`, and `.agents/prompts/*.prompt.md`.
GitHub Copilot also discovers project skills from `.agents/skills`, so the convention is
Copilot-compatible without duplication.

## Decisions

### 1. Adopt the organisation's `.agents/` layout, plus root context files

This repository gains `AGENTS.md` (authoritative repository context and mandatory rules),
`.github/copilot-instructions.md` (the condensed always-on subset), and `.agents/` containing:

- **Agents** — `catalogue-onboarder` (add and integrate a project) and `catalogue-auditor` (audit and
  repair the catalogue).
- **Skills** — `add-catalogue-project`, `audit-catalogue-projects`, `project-manifest-reference`,
  `docs-aggregation-rules`, `use-case-authoring`, `github-repo-metadata`, `site-validation-loop`.
- **Prompts** — `add-project.prompt.md`, `audit-projects.prompt.md`.

The skills document what the code actually does (schema vocabularies and loader rules, the three
`DocsValidationError` cases with their remediations, tags coming from repository topics, the
staleness threshold, the validation chain), so an agent does not have to rediscover it.

### 2. Guidance is paired with a deterministic guard

Prose instructions cannot guarantee correctness, so the invariants that a machine can check live in
`src/scripts/check-projects.ts`, exposed as `just check-projects` and included in `just validate`
(and therefore in `ci:build` and the deploy workflow). It is offline and deterministic: it reads the
manifest, the docs cache/mirror written by `data:sync`, and the release cache/fixtures — no network.

It fails on: duplicate ids or `order` values; a documented project whose `name` does not slugify to
its `id`; a documented project with no aggregated pages; a `docsPage` that does not resolve; a
non-archived project with no use case; a use case with `code` but no `language`; duplicate or
non-`primary` packages; a declared package with no published versions; `status: archived` on an
active repository or `stable` without a stable release; missing repository topics (the tag source); a
documented project whose repository default branch is not `main`; `discussions: true` without
repository discussions; and `externalProjects` pointing at a `purview-dev` repository.

Everything the guard cannot judge — whether the prose is truthful, whether the category is right,
whether the evidence is real — stays an agent/human judgement documented in the audit skill.

### 3. Fix the data, never the check

Consistent with ADR 0001, the guard's contract may only change through an ADR. When it fails, the
remediation is to fix the manifest, the repository metadata, or the implementation — not to relax
the assertion.

## Consequences

- Onboarding and auditing are repeatable, reviewable procedures with a written checklist and a
  machine-checked floor.
- `.agents/**` and `AGENTS.md` sit outside the `src/` package, so they do not affect formatting,
  linting, typechecking, or the Astro build; the guard lives in `src/scripts/` and is covered by the
  existing tooling.
- New invariants should be added to the guard when they become machine-checkable, and to the audit
  skill when they remain judgement calls.
- Contributors who do not use an agent still benefit: `just check-projects` reports catalogue drift
  with remediation text, and the skills are readable documentation of how the catalogue works.
