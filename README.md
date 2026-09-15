# Purview-Dev website

The public website and unified documentation portal for the
[Purview-Dev](https://github.com/purview-dev) open-source organisation. It is a
fully static site that works as both a marketing and project-discovery site and
a single technical documentation portal for the Purview .NET product family.

- Production URL: https://purview.dev
- Documentation: aggregated from every product repository
- Releases: GitHub + NuGet metadata fetched at build time

# Beta notice

This site is currently in **beta**. Release data and aggregated documentation are refreshed from the source repositories on an ongoing basis (the deployment workflow also runs a weekly refresh).

The site is built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build), styled with
[Tailwind CSS](https://tailwindcss.com), and enhanced with a few small
[Preact](https://preactjs.com) islands. Every page is pre-rendered to static
HTML; nothing depends on a server at runtime.

```
src/
├── content.config.ts          # Starlight docs collection schema
├── content/docs/              # GENERATED documentation mirror (gitignored)
├── data/projects.yml          # Typed, validated project catalogue manifest
├── lib/
│   ├── manifest/              # Project manifest schema + validation
│   ├── releases/              # GitHub/NuGet clients, normalisation, transform
│   ├── docs/                  # Documentation aggregation + link/alerts transforms
│   ├── urls.ts                # Canonical URL + base path handling
│   └── site.ts                # Site + brand constants
├── components/                # Shared chrome, Starlight overrides, islands
├── layouts/SiteLayout.astro   # Marketing page layout
├── pages/                     # Home, catalogue, releases, about, 404
└── styles/global.css          # Design tokens + Tailwind/Starlight theme
```

See `docs/decisions/0001-architecture.md` for the architectural decision record.

## Technology choices

| Area                      | Tool                                   | Version |
| ------------------------- | -------------------------------------- | ------- |
| Runtime / package manager | Bun                                    | 1.4.2   |
| Framework                 | Astro                                  | 7.3.2   |
| Documentation theme       | Starlight                              | 0.42.1  |
| Styling                   | Tailwind CSS                           | 4.3.3   |
| Islands                   | Preact                                 | 10.29.8 |
| Linting                   | oxlint                                 | 1.83.0  |
| Formatting                | oxfmt                                  | 0.68.0  |
| TypeScript                | 5.9.3                                  |
| Search                    | Pagefind (bundled with Starlight)      | —       |
| LLM outputs               | starlight-llms-txt                     | 0.12.0  |
| Link validation           | starlight-links-validator + dist crawl | —       |

All application and configuration code is TypeScript. oxfmt does not yet
support `.astro` files (oxc-project/oxc#15665), so `.astro` components are
formatted by hand per the project style guide; they are still linted by oxlint
and type-checked by `astro check`.

## Prerequisites

- [Bun](https://bun.sh) 1.4.2 (the version is pinned in `package.json` via
  `packageManager`)
- [Just](https://github.com/casey/just) (a command runner; install via
  `winget install casey.just`, `brew install just`, or `cargo install just`)
- Git

## Initial setup

```shell
bun install
just install-hooks   # installs Lefthook Git hooks
```

The first build needs network access to fetch documentation from the product
repositories and release metadata from GitHub/NuGet. After that, a typed cache
(`.cache/`) and committed fixtures make offline builds work.

## Bun usage

`bun` is the only package manager and runtime. Use `bun add`/`bun remove` to
change dependencies and commit `bun.lock`. Run scripts with `bun run <script>`.

## Just commands

`just` is the task runner. The authoritative validation command is:

```shell
just validate
```

It runs, in order: formatting check → lint → typecheck → unit tests → branding
asset checks → production build → link crawl → generated-output checks → built
output tests.

| Recipe             | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `install`          | Install dependencies and Git hooks                  |
| `install-hooks`    | Install Lefthook Git hooks only                     |
| `data-sync`        | Refresh docs mirrors and release data (cache-first) |
| `dev`              | Start the dev server (runs data sync first)         |
| `format`           | Format all supported files and auto-fix lint        |
| `format-check`     | Verify formatting                                   |
| `lint`             | Lint all files                                      |
| `typecheck`        | `astro check` + strict TypeScript                   |
| `test`             | Deterministic unit test suite                       |
| `test-dist`        | Assert built outputs (llms, sitemap, no secrets)    |
| `build`            | Production build (runs data sync first)             |
| `preview`          | Preview the production build                        |
| `check-assets`     | Validate branding sources and generated assets      |
| `check-links`      | Validate internal links across `dist/`              |
| `check-generated`  | Validate caches and built outputs                   |
| `fetch-releases`   | Refresh release data from live sources              |
| `refresh-fixtures` | Rebuild committed test fixtures from live sources   |
| `clean`            | Remove build output, caches, and generated mirrors  |

## Lefthook setup

Lefthook installs two hooks:

- `pre-commit`: formats and lints staged files (oxfmt + `oxlint --fix`), then
  re-stages them.
- `pre-push`: runs the complete `just validate`.

Install with `just install-hooks`. The hooks call the same commands as
`package.json` scripts, the `justfile`, and CI — validation is never duplicated.

## Environment variables

See `.env.example`. All values are optional.

| Variable                    | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `SITE_URL`                  | Canonical site URL (default `https://purview.dev`)                           |
| `PAGES_BASE`                | Astro base path; `/` for custom domain/org Pages, `/repo/` for project Pages |
| `GITHUB_TOKEN`              | Optional token to raise GitHub API rate limits (never committed)             |
| `DATA_MODE`                 | `auto` (default), `live`, `cache`, or `fixture`                              |
| `DATA_FALLBACK_TO_FIXTURES` | Whether offline builds may use committed fixtures                            |

Secrets are never included in generated HTML, static JSON, or the client
bundle.

## Local development

```shell
just dev
```

The dev server starts after a data sync. Edit `src/pages/` for marketing pages
and `src/data/projects.yml` for catalogue content. Documentation pages are
generated under `src/content/docs/` and should not be edited by hand — change
the source repository instead and re-run `just data-sync`.

## Testing and validation

Unit tests live in `tests/unit/` (Bun's test runner) and run without network or
live APIs — they use committed fixtures under `fixtures/`. Built-output
assertions live in `tests/dist/`. `just validate` runs everything needed to
prove the site is safe to merge.

## Branding asset handling

The approved branding sources live in `assets/branding/` and are never modified.
`just data-sync` runs `scripts/process-branding.ts`, which copies the assets the
built site needs into `public/` (SVG masters, light/dark logo variants, raster
favicons, touch/application icons, and the generated Open Graph image). The
design tokens in `src/styles/global.css` are derived from the brand values in
`assets/branding/README.md` (purple `#8B3DFF`, deep purple `#6820D2`, ink
`#17141F`/`#FFFFFF`). `just check-assets` validates the sources and the
generated copies.

## Project catalogue

`src/data/projects.yml` is the single source of truth for the catalogue. It is
validated at build time by a typed Zod schema (`src/lib/manifest/schema.ts`).
Validation failures report the source file, the offending property, the
expected shape, and a remediation hint.

### Adding a new Purview-Dev project

1. Add a record to `src/data/projects.yml` with a unique `id`, `name`,
   `shortDescription`, `description`, `repository` (a purview-dev repo),
   `category`, `status`, and optional `order`.
2. Declare its NuGet packages under `packages` — every package id must belong to
   exactly one project.
3. Declare documentation under `docs`:
   - `source: github-path` + `path` for in-repo docs (optionally
     `readmeAsIndex: true`),
   - `source: wiki` for a GitHub wiki,
   - `source: readme` for projects documented by their README.
4. Add relationships with `related`, or `supersededBy`/`supersedes` for
   archived projects.
5. Run `just validate` — the manifest schema, catalogue page, project page,
   docs aggregation, and release transforms are all regenerated from this one
   file.

## Documentation aggregation

Documentation is owned by each product repository and presented through this
portal. The aggregation (`src/lib/docs/aggregate.ts`) fetches each project's
docs (in-repo `docs/`, GitHub wikis via a shallow clone, or the README), then:

- injects front matter (title, description, owners, status, last review date,
  source repository, edit URL),
- converts GitHub alert blockquotes to Starlight asides,
- rewrites relative links and images so they resolve inside the portal,
- honours `_Sidebar.md` ordering when the source provides it.

Each documentation page shows its owning project, lifecycle status, staleness
(last review older than 365 days, configurable in
`src/lib/docs/staleness.ts`), and an edit link to the source repository.

## Release data

Release data is fetched at build time — never from the visitor's browser.
`src/lib/releases/` separates GitHub/NuGet HTTP clients, response normalisation,
semver-based version selection, project↔package association, and the typed
cache. Version selection is based on semver tags because the organisation's
changesets automation publishes `vX.Y.Z-prerelease.N` tags with the GitHub
`prerelease` flag set to `false`.

- `just fetch-releases` fetches live data into `.cache/releases/releases.json`
  (typed, versioned, timestamped, gitignored).
- Without a cache, the site falls back to committed fixtures under
  `fixtures/releases/` and labels the data source (`live` / `cache` /
  `fixture`) in the UI.
- `just refresh-fixtures` regenerates the committed test fixtures from live
  sources (review the diff before committing).

## LLM-readable outputs

The build generates `/llms.txt`, `/llms-small.txt`, and `/llms-full.txt`
(Starlight's `starlight-llms-txt` plugin) using canonical production URLs and
the aggregated documentation. The built outputs are asserted by `tests/dist/`
and `just check-generated`.

## GitHub Pages deployment

`.github/workflows/deploy.yml` builds and deploys the site through the official
GitHub Pages actions (`configure-pages`, `upload-pages-artifact`,
`deploy-pages`). The workflow resolves the deployment base and site URL
automatically:

- **Organisation Pages** (`<owner>.github.io`): base `/`, site
  `https://<owner>.github.io`.
- **Project Pages** (`<owner>/<repo>`): base `/<repo>`, site
  `https://<owner>.github.io`.
- **Custom domain** (recommended for `purview.dev`): set repository **variables**
  `SITE_URL=https://purview.dev` and `PAGES_BASE=/`, or pass
  `pages-base: /` on `workflow_dispatch`.

Configuration notes:

- `public/CNAME` pins the custom domain. Remove it if you do not use
  `purview.dev`.
- Enable Pages with **Source: GitHub Actions** in the repository settings and
  create the `github-pages` environment.
- After enabling the custom domain, add the required DNS records at your
  registrar (CNAME/ALIAS to `purview-dev.github.io`, or A/AAAA per GitHub's
  guidance) and verify the domain in the Pages settings.

The workflow validates (`just validate`), refreshes live release/documentation
data, builds, and uploads `./dist`.

### Repository-dispatch integration

A release in another purview-dev repository can trigger a site rebuild without
granting that repository any secrets. In that repository's release workflow,
call:

```shell
gh api repos/purview-dev/purview-dev/dispatches \
  -f event_type=purview-site-rebuild \
  -f "client_payload[repository]=purview-dev/<repo>" \
  -f "client_payload[version]=<v1.2.3>"
```

The deploy workflow listens for `repository_dispatch` with type
`purview-site-rebuild`. The payload is informational and is not required for
the rebuild to succeed; the build always fetches fresh data itself.

## Dependency maintenance

Dependabot (`.github/dependabot.yml`) keeps Bun dependencies and GitHub Actions
up to date. Minor/patch updates are grouped per ecosystem; major updates are
kept separate for review.

## Troubleshooting

- **Build fails with "No release data available"**: run `just fetch-releases`,
  or check that `DATA_FALLBACK_TO_FIXTURES` is not set to `false` while offline.
- **Docs are missing after a fresh clone**: run `just data-sync` once with
  network access (the docs mirror is generated and gitignored).
- **GitHub API 403s**: you have hit the unauthenticated rate limit. Set a
  `GITHUB_TOKEN` (e.g. from `gh auth token`) or wait for the limit to reset.
- **`.astro` files are not reformatted**: oxfmt does not support Astro yet
  (oxc-project/oxc#15665); format them by hand — they are still linted and
  type-checked.
- **Formatting diffs in generated content**: never edit `src/content/docs/` or
  `.cache/` by hand; regenerate them with `just data-sync`.
