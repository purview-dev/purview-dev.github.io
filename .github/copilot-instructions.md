# Copilot instructions — Purview-Dev website

Read `AGENTS.md` first; it is the authoritative repository context. This file is the condensed
always-on subset.

## What this repository is

The Astro + Starlight website for the Purview-Dev organisation: project catalogue, release browser,
and unified documentation portal aggregated from the product repositories. Bun workspace; the only
package is `src/`.

## Always

- Run commands from the repository root (`bun run <script>`, `just <recipe>`); they delegate to
  `src/`.
- Treat `just validate` as the definition of done. It chains format-check, lint, typecheck, unit
  tests, asset checks, build, link crawl, generated-output checks, built-output tests, and the
  catalogue guard (`just check-projects`).
- Edit the catalogue under `src/src/data/` only (one file per project, plus `external-projects.yml`), and keep every invariant listed in
  `AGENTS.md` (unique ids/orders/packages, `name` slugifying to `id` for documented projects, at
  least one use case per non-archived project, `code` paired with `language`, resolvable `docsPage`).
- Keep documentation where it lives (the product repository). This site aggregates it at build time.
- Use Conventional Commits and keep changes small and reviewable.

## Never

- Never hand-edit `src/src/content/docs/**`, `src/.cache/**`, or `src/dist/**` — they are generated.
  Use `just data-sync`, `just fetch-releases`, or `just build`.
- Never weaken, skip, or delete a check to make a change pass.
- Never add a non-`purview-dev` repository to `projects:`; collaborations belong in
  `externalProjects:`.
- Never invent a `category`, `status`, `audience`, or `install` value; the vocabulary lives in
  `src/src/lib/manifest/schema.ts`.
- Never claim a project is `stable` without a stable NuGet release, or leave a project `stable`
  while its repository is archived.
- Never derive a project's displayed status outside `displayStatus()` (`src/src/lib/status.ts`):
  `experimental: true` is an intent flag orthogonal to `status` (ADR 0004) and is invalid with
  `status: archived`.

## Task routing

- Adding a project → `.agents/agents/catalogue-onboarder.agent.md` and
  `.agents/skills/add-catalogue-project/SKILL.md`.
- Auditing/fixing the catalogue → `.agents/agents/catalogue-auditor.agent.md` and
  `.agents/skills/audit-catalogue-projects/SKILL.md`.
- Any other change → `.agents/` holds the manifest reference, docs-aggregation rules, use-case
  authoring rules, repo-metadata guidance, and the validation loop.
