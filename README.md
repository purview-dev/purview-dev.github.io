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

The repository is a [Bun workspace](https://bun.sh/docs/install/workspaces) whose
single package — the Astro site — lives in `src/`. All commands are run from the
repo root and delegated to the package:

```
purview-dev/                  # workspace root
├── package.json              # workspace root; delegates scripts to src/
├── justfile                  # task runner (runs in the src/ package)
├── docs/decisions/           # architectural decision records
└── src/                      # the Astro site package (@purview-dev/website)
    ├── assets/branding/      # approved branding sources (never modified)
    ├── astro.config.ts       # Astro + Starlight configuration
    ├── public/               # committed static assets (robots.txt, site.webmanifest)
    ├── scripts/              # data sync, branding, checks, fetchers
    ├── src/
    │   ├── content.config.ts # Starlight docs collection schema
    │   ├── content/docs/     # GENERATED documentation mirror (gitignored)
    │   ├── data/projects.yml # Typed, validated project catalogue manifest
    │   ├── lib/              # manifest, releases, docs, urls, site constants
    │   ├── components/       # shared chrome, Starlight overrides, islands
    │   ├── layouts/          # SiteLayout.astro (marketing pages)
    │   ├── pages/            # Home, catalogue, releases, about, 404
    │   └── styles/global.css # design tokens + Tailwind/Starlight theme
    ├── tests/                # unit tests + built-output assertions
    └── fixtures/             # committed offline data fixtures
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
| Sidebar topics            | starlight-sidebar-topics               | 0.9.0   |

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
| `ci-build`         | Full CI validation chain used by the shared pipeline |
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

The dev server starts after a data sync. Edit `src/src/pages/` for marketing
pages and `src/src/data/projects.yml` for catalogue content. Documentation pages
are generated under `src/src/content/docs/` and should not be edited by hand —
change the source repository instead and re-run `just data-sync`.

## Testing and validation

Unit tests live in `src/tests/unit/` (Bun's test runner) and run without network
or live APIs — they use committed fixtures under `src/fixtures/`. Built-output
assertions live in `src/tests/dist/`. `just validate` runs everything needed to
prove the site is safe to merge.

## Branding asset handling

The approved branding sources live in `src/assets/branding/` and are never
modified. `just data-sync` runs `src/scripts/process-branding.ts`, which copies
the assets the built site needs into `src/public/` (adaptive SVG masters for the
favicon, header logo, and banner, light/dark PNG variants, raster favicons,
touch/application icons, and the generated Open Graph image). The design tokens
in `src/src/styles/global.css` are derived from the brand values in
`src/assets/branding/README.md` (purple `#8B3DFF`, deep purple `#6820D2`, ink
`#17141F`/`#FFFFFF`). `just check-assets` validates the sources and the
generated copies.

## Project catalogue

`src/src/data/projects.yml` is the single source of truth for the catalogue. It
is validated at build time by a typed Zod schema
(`src/src/lib/manifest/schema.ts`). Validation failures report the source file,
the offending property, the expected shape, and a remediation hint.

### Adding a new Purview-Dev project

1. Add a record to `src/src/data/projects.yml` with a unique `id`, `name`,
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

### Adding an external (collaboration) project

Projects the organisation contributes to but does not own are listed under
`externalProjects` in the same file. They are rendered in a "Collaborations"
section on the catalogue page and link to their own site/repository (e.g.
`https://likec4.dev` for LikeC4) rather than the Purview catalogue.

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

- `just fetch-releases` fetches live data into `src/.cache/releases/releases.json`
  (typed, versioned, timestamped, gitignored).
- Without a cache, the site falls back to committed fixtures under
  `src/fixtures/releases/` and labels the data source (`live` / `cache` /
  `fixture`) in the UI.
- `just refresh-fixtures` regenerates the committed test fixtures from live
  sources (review the diff before committing).

## LLM-readable outputs

The build generates `/llms.txt`, `/llms-small.txt`, and `/llms-full.txt`
(Starlight's `starlight-llms-txt` plugin) using canonical production URLs and
the aggregated documentation. The built outputs are asserted by `tests/dist/`
and `just check-generated`.

## Site versioning and releases

The site is versioned like every other purview-dev repository. The single
source of truth is the `version` field in the root `package.json`; the footer
shows the current `v{version}` (linking to the repository's GitHub releases
page), read at build time by `src/src/lib/site-version.ts`.

Building and release flow run through the shared
[Purview.Build](https://purview.dev/projects/build/) system as a `Web` project
(`Build:ProjectType=Web` in `purview-build.json`): the pipeline runs the root
`package.json` scripts (`bun install`, `bun run format:check`/`bun run lint`,
`bun run test`) and the `ci:build` script, which chains data sync, typecheck,
asset checks, the production build, link crawl, generated-output checks, and
built-output tests. Releasing means bumping `version` in the root
`package.json` and merging: the `Release` workflow (`purview-release.yml`,
`release-mode: GitHubRelease`) runs the pipeline, tags `v{version}`, and uploads
the built `dist/` zip as a GitHub release asset. Content-only updates do not
need a version bump; they are handled by `deploy.yml`, which republishes the
site to GitHub Pages from the latest synced data.

## GitHub Pages deployment

This repository is the organisation Pages repository
(`purview-dev/purview-dev.github.io`), so the site is served at the root
(`https://purview-dev.github.io/`). `.github/workflows/deploy.yml` builds and
deploys through the official GitHub Pages actions (`configure-pages`,
`upload-pages-artifact`, `deploy-pages`) and resolves the deployment base and
site URL automatically:

- **Organisation Pages** (`<owner>.github.io`): base `/`, site
  `https://<owner>.github.io`.
- **Project Pages** (`<owner>/<repo>`): base `/<repo>`, site
  `https://<owner>.github.io`.
- **Custom domain** (recommended for `purview.dev`): once DNS is configured at
  your registrar (CNAME/ALIAS to `purview-dev.github.io`, or A/AAAA per GitHub's
  guidance), set repository **variables** `SITE_URL=https://purview.dev` and
  `PAGES_BASE=/`, and restore a `public/CNAME` file containing `purview.dev`.

Configuration notes:

- Enable Pages with **Source: GitHub Actions** in the repository settings and
  create the `github-pages` environment.
- The `public/CNAME` file is intentionally absent until the `purview.dev` DNS
  records are configured, so the site stays reachable at the root of
  `purview-dev.github.io`.

The workflow validates (`just validate`), refreshes live release/documentation
data, builds, and uploads `./src/dist`.

### Repository-dispatch integration

A release in another purview-dev repository can trigger a site rebuild without
granting that repository any secrets. In that repository's release workflow,
call:

```shell
gh api repos/purview-dev/purview-dev.github.io/dispatches \
  -f event_type=purview-site-rebuild \
  -f "client_payload[repository]=purview-dev/<repo>" \
  -f "client_payload[version]=<v1.2.3>"
```

The deploy workflow listens for `repository_dispatch` with type
`purview-site-rebuild`. The payload is informational and is not required for
the rebuild to succeed; the build always fetches fresh data itself.

The release workflow is intentionally scoped to root `package.json` changes so
content refreshes do not get blocked by an unchanged version or an existing
`v{version}` tag.

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
- **Formatting diffs in generated content**: never edit `src/src/content/docs/`
  or `src/.cache/` by hand; regenerate them with `just data-sync`.
