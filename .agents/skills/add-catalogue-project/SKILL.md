---
name: add-catalogue-project
description: Use when adding a repository to the Purview-Dev website catalogue — recon the repo, author the projects.yml record (docs, packages, tags, use cases), integrate it across the catalogue/docs/releases surfaces, and prove it with the validation pipeline.
category: purview-dev-website
roles:
    - catalogue
    - docs
    - integration
tags:
    - projects-yml
    - astro
    - starlight
    - documentation
---

# add-catalogue-project Skill

Use this skill when a repository must be added to (or promoted within) the Purview-Dev website.

Related: `project-manifest-reference`, `docs-aggregation-rules`, `use-case-authoring`,
`github-repo-metadata`, `site-validation-loop`.

## Step 0 — decide the target collection

| Situation | Where it goes |
| --- | --- |
| Repository is owned by the `purview-dev` organisation | `projects:` |
| Project the organisation contributes to but does not own (for example `likec4/likec4`) | `externalProjects:` |

Only `projects:` entries get a `/projects/<id>/` page, documentation aggregation, LLM bundles and
release data. `externalProjects:` entries are link-out cards on `/projects/` and must never point at
a `purview-dev` repository.

## Step 1 — recon the repository (never guess)

```shell
# Metadata: description, topics, archived, default branch, discussions, homepage
gh api repos/<owner>/<repo> --jq '{description, topics, archived, default_branch, has_discussions, homepage}'

# Docs layout: does docs/ exist, is it a mirror of the wiki, is there a _Sidebar.md?
gh api "repos/<owner>/<repo>/git/trees/main?recursive=1" --jq '.tree[].path'
gh api "repos/<owner>/<repo>/contents/README.md" -H 'Accept: application/vnd.github.raw'

# Project conventions: build type, agent guidance, licensing
gh api "repos/<owner>/<repo>/contents/purview-build.json" -H 'Accept: application/vnd.github.raw'

# Release channel and tag shape
gh api "repos/<owner>/<repo>/releases?per_page=10" --jq '.[] | {tag_name, prerelease, published_at}'

# Packages: confirm each id exists and see its channel (replace the id)
curl.exe -s "https://api.nuget.org/v3-flatcontainer/<packageid>/index.json"
```

Record, as evidence for the record you are about to write: where the docs live, the exact markdown
file that should be the landing page, the NuGet package ids, the release channel, and the repository
description/topics.

## Step 2 — classify

- `category`: exactly one of `application-framework`, `validation`, `observability`,
  `source-generation`, `aspire`, `build-tooling`, `developer-tooling`.
- `status`:
  - `archived` when the repository is archived (GitHub `archived: true`).
  - `preview` when there is no stable NuGet release, or the tooling is explicitly experimental.
  - `stable` only when a stable (non-prerelease) release exists and is recommended for use.
- `id`: lowercase `[a-z0-9-]` slug, normally the repository name.
- `name`: display name. **It must slugify to `id` when the project has `docs`** (the LLM bundle is
  emitted at `/_llms-txt/<slug(name)>.txt` while the UI links `/_llms-txt/<id>.txt`).
- `order`: pick an unused value (10–80 in tens is the existing convention).

## Step 3 — author the record

Add the entry to `src/src/data/projects.yml` (see `project-manifest-reference` for every field):

```yaml
  - id: <slug>
    name: <Display Name>
    shortDescription: <one sentence, kept short>
    description: >-
      <two to four sentences: what it is, what it replaces, what it generates/does>
    origin: >-
      <why this became reusable tooling>
    useWhen: >-
      <the situation where it is the right choice>
    avoidWhen: >-
      <the situation where it is the wrong choice>
    repository: purview-dev/<repo>
    category: <category>
    status: <status>
    order: <unused order>
    docs:
      source: github-path | wiki | readme
      path: docs            # github-path only
      rootPage: Getting-Started.md   # optional; see docs-aggregation-rules
      exclude: [ _Sidebar.md, index.md ]
    targetFrameworks: [ net8.0, net9.0 ]
    install: nuget | msbuild-sdk | dotnet-tool   # only when not a plain NuGet package
    packages:
      - id: <NuGet.Package.Id>
        description: <what this package is for>
        primary: true
    related: [ <known-project-id> ]
    acknowledgments:
      - name: <upstream project>
        url: https://github.com/<owner>/<repo>
        description: <how this project relates to it>
    useCases:
      - audience: developer
        title: <short, concrete scenario title>
        scenario: >-
          <the situation the reader is in>
        code: |
          <minimal snippet that shows the idea>
        language: csharp
        outcome: >-
          <what the reader gets back>
        evidence: >-
          <a fact: before/after, count, generated output, measured property>
        docsPage: <slug-of-an-aggregated-page>
    discussions: false
```

Every non-archived project needs at least **one** use case with `code` + `language` and an
`evidence` fact (ADR 0002). See `use-case-authoring`.

## Step 4 — fix the upstream metadata (this is where tags come from)

- Set GitHub **topics** on the repository (they become the site's tag chips). See
  `github-repo-metadata` for the exact command and the taxonomy guidance.
- The repository description must be genuinely descriptive: it backs the `shortDescription`
  fallback and social/`og:` metadata.
- Only set `discussions: true` once GitHub Discussions is actually enabled on the repository.

## Step 5 — integrate and verify

```shell
just data-sync          # aggregate docs + refresh release data (cache-first)
just check-projects     # deterministic catalogue guard (part of `just validate`)
bun run typecheck && bun run test
just check-generated
just validate           # full chain: format, lint, build, link crawl, dist tests
```

Confirm each surface actually lights up:

1. `/projects/` shows the card with the right category/status/tags (tags come from topics).
2. `/projects/<id>/` renders description, use cases, install panel, packages, and related links.
3. `/docs/<id>/` exists with the expected page count and a sidebar topic named after the project.
4. `/_llms-txt/<id>.txt` is emitted and linked from `/llms.txt`.
5. `/use-cases/` lists the new use cases under the right audiences.
6. `/releases/` shows GitHub/NuGet versions for the declared packages.

## Step 6 — report

State: the record added, the recon evidence, the package ids and channels, the docs source and page
count, the checks run with their result, and any `upstream` follow-ups (for example: topics missing,
docs not yet in a `docs/` folder, no stable release yet).

## Pitfalls

- `docs.path` must be a **repository path** (`docs`, `docs/wiki`), never a URL.
- A repository whose wiki is mirrored into `docs/wiki` usually needs
  `exclude: [_Sidebar.md, Home.md, index.md]` plus `rootPage: Getting-Started.md`, otherwise the
  aggregation raises `DocsValidationError`. See `docs-aggregation-rules`.
- Aggregation reads branch `main`. If the repository's default branch is `master`/`develop`, docs
  aggregation silently yields nothing — rename or report it.
- The `README.md`-as-index mode (`readme:`) publishes exactly one page and cannot be combined with
  `rootPage`.
- Adding a project does not require editing tests: the manifest tests assert `>=` counts, not exact
  membership. But keep their expectations true (for example the `>= 8` use-case coverage).
