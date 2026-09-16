# ADR 0001 — Architecture: Astro + Starlight with build-time data aggregation

- Status: accepted
- Date: 2026-09-15

## Context

Purview-Dev needs a public website that is both a marketing and project-discovery
site and a unified technical documentation portal for its .NET product family.
The site must be fully static, deployable to GitHub Pages (organisation, project,
or custom domain), and easy to contribute to locally.

## Decisions

### 1. Astro plus Starlight for the framework

Astro renders every page to static HTML with zero client runtime by default,
which satisfies the "no persistent server" and "usable without JavaScript"
requirements. Starlight is the official documentation theme for Astro and
provides the mature, accessible machinery we do not want to rebuild: structured
sidebars, full-text Pagefind search, syntax highlighting, table of contents,
previous/next navigation, callouts, heading anchors, i18n, and edit links.
Marketing pages share Starlight's chrome (header, theme toggle, search, footer)
via a Header override and a shared `SiteLayout`, so the catalogue, releases,
and documentation pages are visually coherent.

### 2. Static build-time data aggregation

All external data (GitHub repository/release metadata and NuGet package data)
is fetched once during the build by typed Bun scripts and cached locally, never
queried by the visitor's browser. This keeps the site fast and avoids exposing
tokens or credentials. A typed, versioned cache records when data was retrieved
and degrades gracefully to committed fixtures offline, with a visible source
label (`live` / `cache` / `fixture`) so stale data is never presented as fresh.

### 3. Distributed documentation ownership with central presentation

Documentation stays in each product repository (`eventsourcing/docs/`,
`telemetry-sourcegenerator` wiki, `zodsharp` README, etc.) and is aggregated
into Starlight's content collection at build time. The aggregation injects
front matter (title, description, owners, status, last review date, source
repository, edit URL), converts GitHub alert blockquotes to Starlight asides,
rewrites relative links and images so they work inside the portal, and resolves
`_Sidebar.md` ordering where the source provides it. Each page exposes its
owning project, lifecycle status, staleness, and an edit link back to the source
repository. Documentation is served under `/docs/<project>/` (e.g.
`/docs/telemetry-sourcegenerator/`), keeping all documentation pages under a
single `/docs/*` namespace while each project keeps its own sidebar section.
Content stays in the default locale, which is required for `llms.txt`
generation and avoids a misleading language selector.

### 4. Preact islands instead of a client-heavy application

The site is not a single-page application. Client-side interactivity is limited
to three small Preact islands: catalogue filtering, release filtering, and a
copy-command button. All meaningful content and links exist in the generated
HTML before hydration; the islands only enhance them. Hydration uses the least
expensive directive that works (`client:visible` / `client:idle`).

### 5. Bun, Just, and Lefthook for the local-first workflow

Bun is the sole package manager and runtime (`bun.lock` committed, version
pinned via `packageManager` and `oven-sh/setup-bun`). Just wraps the workflow in
a cross-platform `justfile` (the shell is switched to pwsh on Windows), and
Lefthook runs fast formatting/linting on staged files before commits and the
full `just validate` before pushes. The same `just validate` pipeline is used by
GitHub Actions, so there is a single source of truth for validation.

### 6. oxlint and oxfmt instead of ESLint and Prettier

Per organisational direction, linting and formatting use the Oxc toolchain
(`oxlint` 1.83, `oxfmt` 0.68) rather than ESLint/Prettier. Both support
TypeScript configuration files, and oxlint bundles native Rust plugins
(including `jsx-a11y`) plus type-aware rules; oxfmt provides built-in import
sorting and Tailwind class sorting. Known limitation: oxfmt has no `.astro`
support yet (oxc-project/oxc#15665), so `.astro` components are formatted by
hand per the project style guide while still being linted by oxlint (frontmatter
and `<script>` blocks) and type-checked by `astro check`.

## Consequences

- Every dependency and tool version is pinned and recorded in the final report.
- Local development needs network access for the first docs/release sync;
  afterwards the typed cache and committed fixtures make builds deterministic.
- A new project is added by editing `src/data/projects.yml`; documentation is
  fetched from its repository automatically.
- Breaking the validation pipeline requires fixing the implementation, not
  weakening the checks.
