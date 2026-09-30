---
name: project-manifest-reference
description: Field-by-field reference for the catalogue records under src/src/data/projects/ (schema vocabulary, defaults, loader-enforced rules, and the invariants the site build depends on). Use whenever authoring or reviewing a catalogue record.
category: purview-dev-website
roles:
    - catalogue
    - reference
tags:
    - projects-yml
    - zod
    - schema
---

# project-manifest-reference Skill

The catalogue is one file per project under `src/src/data/projects/` (plus
`src/src/data/external-projects.yml` for collaborations), typed by `src/src/lib/manifest/schema.ts` and validated
by `src/src/lib/manifest/load.ts`. `$schema: ../lib/manifest/schema.ts` is the first line of the file.

## Vocabularies (do not invent values)

| Field | Allowed values |
| --- | --- |
| `category` | `application-framework`, `validation`, `observability`, `source-generation`, `aspire`, `build-tooling`, `developer-tooling` |
| `status` | `stable`, `preview`, `archived` |
| `experimental` | boolean flag, default `false` — orthogonal to `status` (ADR 0004); invalid with `status: archived` |
| `install` | `nuget` (default), `msbuild-sdk`, `dotnet-tool` |
| `useCases[].audience` | `developer`, `team-lead`, `architect`, `contributor` (labels: Developer, Team lead, Architect, Contributor) |

Adding a value to any of these lists is a schema change and requires an ADR. `experimental` is a
**flag, not a status value**: it never replaces `status`, which stays the project's release channel.

## `projects[]` fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase `[a-z0-9-]` slug; also the URL segment and the LLM bundle name |
| `name` | yes | Display name; **must slugify to `id` when `docs` is set**; must not start with `Purview ` |
| `shortDescription` | yes | One sentence; falls back to the GitHub description if empty, then to `name` |
| `description` | yes | Long description (2–4 sentences) |
| `origin` | yes | Why the project became reusable tooling |
| `useWhen` | yes | When it is the right choice |
| `avoidWhen` | yes | When it is the wrong choice |
| `repository` | yes | `owner/repository`; **`owner` must be `purview-dev`** for `projects[]` |
| `category` | yes | See vocabulary |
| `status` | yes | See vocabulary |
| `experimental` | no | Default `false`; marks an exploratory project (unstable API, no support promise). Orthogonal to `status`; invalid with `status: archived`. Displayed as its own status via `displayStatus()` |
| `featured` | no | Default `false`; shown prominently on the home page |
| `order` | no | Default `1000`; projects are sorted ascending; keep values unique |
| `docs` | no | See below |
| `install` | no | Default `nuget` |
| `targetFrameworks` | no | e.g. `net8.0`, `net9.0`, `net10.0`, `netstandard2.0` |
| `packages` | no | `{ id, description?, primary?, targetFrameworks? }[]`; defaults to `[]` |
| `related` | no | Known project ids; rendered in the project page aside |
| `useCases` | no | Default `[]`; at least one required for non-archived projects |
| `acknowledgments` | no | `{ name, url, description? }[]`; upstream work the project credits |
| `supersedes` / `supersededBy` | no | Known project ids; used for archived/successor messaging |
| `discussions` | no | Default `false`; when true the page links to repository Discussions (the repository must have them enabled) |

## `docs` (a discriminated union on `source`)

| `source` | Fields | Behaviour |
| --- | --- | --- |
| `github-path` | `path` (required), plus `rootPage`, `readmeAsIndex`, `order`, `exclude` | Walks `<path>/**/*.md` on branch `main` |
| `wiki` | `rootPage`, `readmeAsIndex`, `order`, `exclude` | Shallow-clones `<repo>.wiki.git`; `_Sidebar.md` orders pages, `_Footer.md` is skipped |
| `readme` | none | Publishes `README.md` alone as `/docs/<id>/` |

- `rootPage` names the markdown file that becomes the landing page (`index`). It may only select a
  non-index page when the conventional root page is removed via `exclude` (the aggregation otherwise
  raises `DocsValidationError`).
- `exclude` matches the **base file name** (not the repository path) and supports `*` wildcards.
- `readmeAsIndex` uses the repository `README.md` as the landing page and cannot be combined with
  `rootPage`; it aliases `readme` to `index`.
- `order` is an explicit list of page slugs, applied before the `_Sidebar.md` order.
- If `docs` is set but the aggregation yields no pages, `just data-sync` fails loudly.

## Loader-enforced rules (`loadProjects()`)

1. Schema validation with remediation text (unknown keys are rejected).
2. `projects[].repository.split('/')[0]` must equal `purview-dev`.
3. `related`, `supersedes`, and `supersededBy` must all reference existing project ids.
4. A NuGet package id may be declared by **exactly one** project.
5. `experimental: true` is rejected when `status` is `archived` (schema refinement).
6. The returned list is sorted by `order` ascending.

## Defaults applied by the loader

`featured: false`, `order: 1000`, `packages: []`, `related: []`, `useCases: []`,
`acknowledgments: []`, `discussions: false`, `install: 'nuget'`, `experimental: false`. Derived values (`repoOwner`,
`repoName`, `sourceUrl`, `issuesUrl`, `discussionsUrl`, `changelogUrl`, `releasesUrl`) are computed,
never authored.

## `externalProjects[]` fields

Required: `id` (slug), `name`, `shortDescription`, `description`, `url` (valid URL), `category`.
Optional: `repository` (`owner/repo`, link target), `status`, `featured`, `order`.
Loader-enforced: a collaboration entry must **not** use the `purview-dev` owner (the manifest test
asserts that no `externalProjects` id starts with `purview-`).
