# AGENTS.md

## Purpose

This repository builds the Purview-Dev public website: a fully static Astro + Starlight site that is
both the project catalogue/release browser and the unified documentation portal for the Purview .NET
product family (production URL: https://purview.dev).

Two agent tasks recur here, and both have a dedicated agent plus skills under `.agents/`:

1. **Add a project** — given a `purview-dev/<repo>` (or a collaboration repository), build its
   documentation, use cases, tags and metadata so it is fully integrated into the site.
2. **Audit the catalogue** — prove that every project defined in `src/src/data/projects/` (one file per project, plus
   `external-projects.yml` for collaborations) is
   correct: documentation configuration, lifecycle stability, metadata and relationships.

## Technology and tooling context

This is a Bun workspace whose single package (the Astro site) lives in `src/`. Every command is run
from the repository root and delegated to the package.

- **Runtime / package manager:** Bun 1.4.2 (`packageManager` pinned; `bun.lock` committed).
- **Framework:** Astro 7 with Starlight 0.42, Tailwind 4, and four small Preact islands. Output is
  static HTML; nothing depends on a server at runtime.
- **All code is TypeScript.** Linting/formatting use the Oxc toolchain (`oxlint`, `oxfmt`).
  `oxfmt` does **not** support `.astro` yet (oxc-project/oxc#15665) — format those by hand and rely
  on `astro check` + oxlint.
- **Task runner:** Just (`justfile`; switches to pwsh on Windows).
- **All external data is fetched at build time**, never by the visitor's browser: GitHub releases,
  NuGet and npm registry data, the documentation mirror, and any `assets:` a project mirrors into
  `public/`, cached under `src/.cache/` with committed fixtures as the offline fallback. The one
  exception is the package **version numbers** the page already displays: the browser re-checks them
  against the registry that publishes the package (NuGet or npm), applies any higher version, and
  stores it (ADR 0008, ADR 0012).

### Generated outputs — never edit by hand

| Path | What it is | Regenerate with |
| --- | --- | --- |
| `src/src/content/docs/**` | Aggregated documentation mirror (gitignored) | `just data-sync` |
| `src/.cache/docs`, `src/.cache/releases` | Typed docs/release caches (gitignored) | `just data-sync` / `just fetch-releases` |
| `src/public/schemas/**` | Mirrored project assets declared in `assets:` (gitignored) | `just data-sync` |
| `src/public/skills/**` | Mirrored Agent Skills declared in `skills:` (gitignored) | `just data-sync` |
| `src/dist/**` | Production build output (gitignored) | `just build` |

### Authoritative validation

```shell
just validate
```

runs format-check → lint → typecheck → unit tests → asset checks → catalogue checks → build →
link crawl → generated-output checks → built-output tests. It is the same pipeline CI uses
(`purview-build.json` → `bun run ci:build`), so a green `just validate` is the definition of "safe to
merge". `just check-projects` is part of that chain and fails the build on catalogue drift. It also
prints advisory observations (which never fail the build) when a project's declared `status` or
`targetFrameworks` disagree with the versions and frameworks its packages have actually published.

## Ecosystem model — what "a project" means here

- `projects:` entries — one file per project under `src/src/data/projects/` — are Purview-owned catalogue entries. Their `repository`
  **must** be `purview-dev/<repo>` (enforced by the loader).
- `externalProjects:` are collaborations the organisation contributes to but does not own (for
  example `likec4/likec4`). They link out to their own site/repository: no documentation
  aggregation, no NuGet packages, no `/projects/<id>/` page.
- Documentation stays in the product repository and is aggregated at build time into
  `/docs/<project-id>/`. **Tag chips are not authored in the manifest** — they come from the GitHub
  repository's *topics*, read through the release cache.
- Versions and release dates come from GitHub releases plus the registry that publishes each
  package: the NuGet flat-container index, or npm's registry document.

## Mandatory rules

1. **Never weaken a check to make a change pass.** Fix the data or the implementation. (ADR 0001.)
2. **Never hand-edit generated content** (`src/src/content/docs/**`, `src/.cache/**`, `src/dist/**`).
3. **Any edit to a project record under `src/src/data/` must keep the catalogue invariants.** These are enforced by
   `loadProjects()` (schema, ownership, relationships, package uniqueness) and by
   `just check-projects`:
   - `id` is a lowercase `[a-z0-9-]` slug; `repository` is `owner/repository` and must be
     `purview-dev/*` for `projects:` entries.
   - For any project with `docs`, the display `name` must slugify to exactly `id` (so the display
     name and the `/projects/<id>/` and `/docs/<id>/` URLs agree).
   - Package ids are unique across the whole catalogue for their registry (`registry:id`; an absent
      `registry` means `nuget`, ADR 0012); when a project has more than one
     package, exactly one must be `primary: true`.
   - Every non-archived project needs at least one concrete use case; a use case with `code` must
     also set `language`, and `docsPage` must be a lowercase `[a-z0-9-]` slug that resolves to a real
     aggregated page.
   - Documentation channels are optional (ADR 0009): `docs.channels.live` / `docs.channels.prerelease`
     pin a project's live and prerelease documentation to refs (`default`, `latest-stable`,
     `latest-prerelease`, or an explicit branch/tag). The default channel owns `/docs/<id>/`, the
     other is served at `/docs/<id>/<channel>/`, and `docsPage` resolves against the default channel.
     Each channel is a first-class docs set — its own page list (the sidebar lists the project once
     but follows the version being read), its own `/projects/<id>/<channel>/llms*.txt` bundle, and
     its own entry on the docs portal. The page switcher, not the sidebar, chooses the version.
     Only `github-path` supports two channels; `wiki`/`readme` have a single version. Promotion is
     automatic: the prerelease channel is withheld once a stable release (GitHub release or NuGet
     version) catches up with the prerelease line, and returns with the next prerelease — never
     delete the declaration to stop publishing it.
   - A page's slug is its path from the docs root (ADR 0011): a topic folder stays a path segment
     (`schemas/Custom-Rules.md` is published at `/docs/<id>/schemas/custom-rules/`), a flat corpus
     keeps the single-segment slug it always had, and every relative link resolves against the page
     that contains it. The display mirrors that tree: the docs sidebar nests each folder as a group
     (labelled with the folder's name spelled out) and each page names its section above the title,
     so a flat corpus renders exactly as before. A project whose docs are reorganised records the
     old→new slug in `docs.redirects`, which the build turns into redirects on **every** channel that
     publishes the tree — the default channel at `/docs/<id>/` and the prerelease one at
     `/docs/<id>/prerelease/`, each pair written only once its destination exists; a redirect never
     shadows a real page.
   - Agent Skills a project publishes are declared in `skills:` (ADR 0010) at
     `skills/<name>/SKILL.md`; the sync mirrors the whole directory to
     `/skills/<id>/<name>/` and each project page renders the same install block
     (npm, bun, pnpm and yarn runners) plus that project's skill list with the
     descriptions from each `SKILL.md`. `/skills/` redirects to `/projects/`.
     Never ship a skill in a package or copy it
     into an agent directory at build time, and never hand-edit `src/public/skills/`.
   - `order` values are unique and control the catalogue order.
   - `related`, `supersedes`, `supersededBy` must reference known ids.
   - `status` must match reality: an archived repository is `archived`; prerelease-only tooling is
     `preview`; a project with a stable release on its package registry is `stable`.
   - Declared versions and frameworks must agree with what the packages publish: a stable package
     version on a `preview` project, a deprecated or unlisted NuGet package, packages that trail the family
     version, and a `targetFrameworks` set (project- or package-level) that does not match the
     packages' NuGet metadata are reported as advisory observations by `just check-projects`. They
     never fail the build, but they are catalogue drift and should be fixed or explicitly accepted.
     Run `just fix-projects` to apply the guard's machine-applicable fixes (a dry run by default;
     pass `--write` to edit the records).
   - `experimental: true` marks a project whose API and packaging may change without notice
     (ADR 0004). It is orthogonal to `status` — which stays the release channel — it is invalid on an
     `archived` project, and it never hides a project: it adds a warning badge and a notice to the
     catalogue and to every aggregated documentation page.
4. **Run the validation loop before finishing** — at minimum `just check-projects`,
   `bun run typecheck`, `bun run test`; run the full `just validate` for anything that touches the
   build, data aggregation, or rendering.
5. **Commits use Conventional Commits** (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`,
   `ci`). Keep them small and reviewable; do not mix unrelated changes.
6. **Releasing is a version bump**, not a content change: bump `version` in the root `package.json`
   and merge. Content-only updates (manifest, docs, use cases) are published by the deploy workflow
   and need no bump.
7. **The schema vocabulary is deliberate.** Adding a `category`, `status`, `audience` or `install`
   kind is a considered ADR-level decision, not a free-text label.

## Agent resources (`.agents/`)

Do not assume this file contains everything; consult `.agents/` while planning.

- `.github/copilot-instructions.md` — the condensed always-on rules for Copilot.
- `.agents/agents/catalogue-onboarder.agent.md` — add and integrate a project end-to-end.
- `.agents/agents/catalogue-auditor.agent.md` — audit (and repair) the whole catalogue.
- `.agents/skills/add-catalogue-project/SKILL.md` — the ordered onboarding procedure.
- `.agents/skills/add-project-intake/SKILL.md` — the intake interview: the questions to ask, what
  recon answers instead, and the field each answer decides.
- `.agents/skills/audit-catalogue-projects/SKILL.md` — the audit procedure and report format.
- `.agents/skills/project-manifest-reference/SKILL.md` — every manifest field and rule.
- `.agents/skills/docs-aggregation-rules/SKILL.md` — how repository docs become `/docs/<id>/`.
- `.agents/skills/use-case-authoring/SKILL.md` — concrete, audience-tagged use cases (ADR 0002).
- `.agents/skills/github-repo-metadata/SKILL.md` — topics, descriptions, stability signals.
- `.agents/skills/site-validation-loop/SKILL.md` — the checks, and how to reproduce failures.
- `.agents/prompts/add-project.prompt.md`, `.agents/prompts/audit-projects.prompt.md`.

## Key entry points

| Concern | Location |
| --- | --- |
| Catalogue manifest | `src/src/data/projects/<id>.yml` (one per project) + `src/src/data/external-projects.yml` |
| Manifest schema / loader | `src/src/lib/manifest/{schema,load}.ts` |
| Docs aggregation | `src/src/lib/docs/aggregate.ts` (+ `frontmatter`, `links`, `sidebar`, `staleness`) |
| Release data | `src/src/lib/releases/*`, `src/scripts/fetch-releases.ts` |
| Mirrored project assets | `src/scripts/sync-assets.ts` (`assets:` in the manifest) |
| Pages | `src/src/pages/{index,about,use-cases,docs,projects,releases}/` |
| Live examples | `src/src/pages/examples/<project-id>.mdx` (linked from the project page automatically) |
| Validation | `justfile`, `src/scripts/{check-links,check-generated,check-assets,check-projects}.ts` |
| Architecture decisions | `docs/decisions/*.md` |
