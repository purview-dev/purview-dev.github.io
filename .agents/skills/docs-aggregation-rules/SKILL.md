---
name: docs-aggregation-rules
description: How the website aggregates documentation from product repositories into /docs/<project>/ — sources, root-page and exclusion rules, ordering, injected front matter, tags from repository topics, staleness, and the failure modes with their remediations.
category: purview-dev-website
roles:
    - docs
    - reference
tags:
    - starlight
    - documentation
    - aggregation
---

# docs-aggregation-rules Skill

`just data-sync` runs `src/scripts/sync-docs.ts` → `aggregateDocs()` in
`src/src/lib/docs/aggregate.ts`. It reads each catalogue project's `docs` configuration, fetches
the markdown from the product repository, writes the mirror to `src/src/content/docs/docs/<id>/`
and records the page list in `src/.cache/docs/index.json`.

**Never edit the mirror by hand** — it is gitignored and regenerated.

## Where content comes from

| `docs.source` | Fetch mechanism | Notes |
| --- | --- | --- |
| `github-path` | Repository tree (`git/trees/main?recursive=1`) filtered to `<path>/**/*.md` | Each file fetched from `raw.githubusercontent.com` on branch `main` |
| `wiki` | `git clone --depth 1 https://github.com/<repo>.wiki.git` | `_Sidebar.md` and `_Footer.md` are never rendered |
| `readme` | Raw `README.md` | Exactly one page (`index`) |

Branch is always **`main`**. `lastReviewed` is the last commit date for the file (Atom feed for
`github-path`/`readme`, wiki HEAD commit for `wiki`).

## Root page selection (the most common onboarding failure)

1. A conventional index file wins by default: `index.md`, `Home.md`, or `readme.md` (case-insensitive
   basename).
2. `docs.rootPage` may override it **only** when that conventional file is removed with
   `docs.exclude`. Otherwise aggregation raises `DocsValidationError`:
   *"selects a non-index page while a conventional root page already exists"*.
3. If no index file and no `rootPage` exist, aggregation raises
   *"docs: no root page exists"* — add `index.md`/`Home.md`/`readme.md` or set `rootPage`.
4. If `rootPage` names a file that does not exist, aggregation raises
   *"docs.rootPage: ... does not exist"*.

The wikis of several product repositories are mirrored into `docs/wiki`, so the working pattern is:

```yaml
    docs:
      source: github-path
      path: docs/wiki
      rootPage: Getting-Started.md
      exclude: [ _Sidebar.md, Home.md, index.md ]
```

## Exclusions and ordering

- `exclude` matches the **base file name** (`index.md`, `_Sidebar.md`) with `*` wildcards; it is
  applied **before** the root page is selected (that is what makes rule 2 work).
- Page order comes from, in priority: `docs.order` (explicit slug list) → a `_Sidebar.md` link order
  (both for `wiki` and for a mirrored wiki under `github-path`) → `1000`.
- The landing page is always `order: -1`, so it heads the sidebar as "Overview".
- Page slugs are slugified file names (`Getting-Started.md` → `getting-started`) and the URLs are
  `/docs/<id>/<slug>/`. A `docsPage` in a use case must use that slug form.

## Injected front matter (per page)

`title` (first `# H1`, else the slug), `description` (first prose paragraph, ≤160 chars),
`owners: [purview-dev]`, `status` (the project's status), `lastReviewed`, `sourceProject`,
`sourceRepo`, `projectName`, `sourcePath`, `editUrl`, `tags` (the repository's GitHub **topics**,
absent when there are none), and `sidebar.label`/`sidebar.order`.

Additional transformations: GitHub alert blockquotes become Starlight asides; relative links between
documents are rewritten to portal URLs; images are rewritten to GitHub raw URLs; duplicate top-level
H1s are demoted to keep one title per document.

## What the site does with it

- Each documented project becomes a `starlight-sidebar-topics` topic whose items come from
  `src/.cache/docs/index.json` (so the mirror and the manifest must come from the same sync).
- Archived projects are excluded from the docs portal, the sidebar topics, and per-project LLM
  bundles, even if they declare `docs`.
- Every documented project gets `/_llms-txt/<id>.txt` (built from `rawContent`), linked from
  `/llms.txt` and from the project page.
- Staleness: a page is flagged when `lastReviewed` is older than 365 days
  (`src/src/lib/docs/staleness.ts`).

## Verifying

```shell
just data-sync                      # expect "docs <id>: <n> pages" per project
node -e "console.log(require('./src/.cache/docs/index.json').projects)"
just build && just check-generated  # asserts the mirror matches the manifest
```
