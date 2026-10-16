---
name: add-project-intake
description: Use when starting to add a repository to the Purview-Dev website catalogue — the intake interview: what to ask the human, what recon answers instead, and how each answer maps to a manifest field, its vocabulary, its recommended default, and the invariant it protects.
category: purview-dev-website
roles:
    - catalogue
    - intake
    - requirements
tags:
    - projects-yml
    - questions
    - recon
    - decisions
---

# add-project-intake Skill

This is the front door for adding a project. It covers **the decisions a human has to make** and
turns them into a short, ordered question set; the mechanical work that follows lives in
`add-catalogue-project`. Related: `project-manifest-reference`, `docs-aggregation-rules`,
`use-case-authoring`, `github-repo-metadata`, `site-validation-loop`.

The catalogue is a curated surface, not a mirror of GitHub. Recon can fill most fields exactly;
the rest are judgement calls that must be **asked, not guessed** — a wrong `category` or `status`
is catalogue drift that no check catches, and a fabricated use case is worse than a missing one.

## Rule 1 — recon first, then ask only what recon cannot answer

Never ask a question whose answer is in the repository. Fetch it, show the evidence, and move on.

| Answered by recon (never ask) | Command |
| --- | --- |
| Owner, description, topics, archived, default branch, discussions, homepage | `gh api repos/<owner>/<repo>` |
| Docs layout and the landing-page candidates | `gh api "repos/<owner>/<repo>/git/trees/main?recursive=1"` |
| Package ids and the release channel | `curl https://api.nuget.org/v3-flatcontainer/<id>/index.json` |
| `install` kind, target frameworks, the reader-facing package set | the nuspec / `.config/purview-build.json` |

The commands and the evidence to record are listed in `add-catalogue-project` (Step 1). Recon first
also means the questions below arrive with a **recommended default** and the evidence for it, so the
human confirms rather than supplies from memory.

## Rule 2 — ask these questions

Each row is one decision. Ask one at a time, lead with the recommendation, and name the field it
decides. "Required" means stop and ask; "confirm" means propose a value and let the human correct it.

### Identity and scope

| # | Question | Decides | Default / rule |
| --- | --- | --- | --- |
| 1 | Is this repository owned by `purview-dev`, or is it a collaboration? **Required only when the owner is ambiguous** (a fork, a shared org, a repo the org contributes to but does not own). | `projects:` vs `externalProjects:` | Owner from `gh api`. Only `purview-dev/*` may go in `projects:`; collaborations get a link-out card and no docs aggregation. |
| 2 | The `id` is normally the repository name. **If a `purview.dev/projects/<id>/` URL is already published** (NuGet `projectUrl`, repository homepage), the id is committed — changing it breaks a live link. Confirm before choosing a different id. | `id` | Repository name. Lowercase `[a-z0-9-]`. |
| 3 | For any project with `docs`, the display `name` must slugify to exactly `id` (the LLM bundle is emitted at `/_llms-txt/<slug(name)>.txt` while the UI links `/_llms-txt/<id>.txt`). **Required whenever the natural display name does not slugify to the id** — e.g. "Architecture Testing" → `architecture-testing`, which is not `architests`. Ask which side moves: rename the display name, or change the id (and the URL). | `name` | A display name that slugifies to `id`; must not start with `Purview `. |

### Classification (judgement — confirm, never pick silently)

| # | Question | Decides | Default / rule |
| --- | --- | --- | --- |
| 4 | Which `category`? **Required when the project straddles two** (for example architecture tests: `developer-tooling` — a tool you add to a repository — or `validation` — the input/data-validation bucket, currently ZodSharp). | `category` | Exactly one of the seven vocabulary values; never a new label. |
| 5 | `status` follows the release channel: an archived repository is `archived`, prerelease-only tooling is `preview`, a project with a stable (non-prerelease) NuGet version is `stable`. **Ask only when the channel and the intent disagree** — a stable package for a project that is not yet recommended (keep `preview` and record why), or a package that is not published yet. | `status` | Derived from GitHub `archived` + the NuGet index; never "stable" without a stable version. |
| 6 | Is this an **experiment** — the API, defaults and packaging may change between prereleases and there is no production support guarantee? **Ask; it is orthogonal to `status`** and invalid on an archived project. | `experimental` | `false`. `true` adds a warning badge to the catalogue and every aggregated docs page (ADR 0004). |

### Documentation (recon decides; ask only on a failure mode)

| # | Question | Decides | Default / rule |
| --- | --- | --- | --- |
| 7 | Where do the docs live — `docs/`, a wiki mirrored into `docs/wiki/`, or only `README.md`? | `docs.source`, `docs.path` | `github-path` at `docs` when the tree has one; `wiki` for a real wiki; `readme` publishes exactly one page. |
| 8 | **Required when there is no conventional root page** (`index.md` / `Home.md` / `readme.md`): which page should be the landing page? **Required when a conventional root page exists but a different page should lead:** promoting it means the conventional page must be removed with `exclude`. | `docs.rootPage`, `docs.exclude` | Conventional index wins by default; `rootPage` may only override it when that file is excluded, or aggregation raises `DocsValidationError`. |
| 9 | The repository default branch is not `main` — can it be renamed, or should the docs move? (Aggregation only reads `main`.) | `docs` viability | **Required** — a non-`main` branch silently yields no pages. |

### Packages, install and frameworks (recon decides; ask to confirm the reader's choice)

| # | Question | Decides | Default / rule |
| --- | --- | --- | --- |
| 10 | When there is more than one package: **which one should a reader install first?** | `packages[].primary` | Exactly one `primary: true` when there are two or more packages. |
| 11 | Is any declared package internal-only (an abstractions or runtime companion) rather than something a consumer installs? | `packages[].description` | Declare it anyway with a description; only one is primary. |
| 12 | How is the primary package consumed — a plain NuGet reference, an MSBuild SDK, or a `dotnet` tool? | `install` | `nuget`; recon from the nuspec / `purview-build.json`. |
| 13 | *(Do not ask.)* Which target frameworks does it publish? | `targetFrameworks` | Read from the nuspec; the guard compares it and `just fix-projects` can rewrite it. |

### Curation and relationships (only the human knows these)

| # | Question | Decides | Default / rule |
| --- | --- | --- | --- |
| 14 | Should it be featured on the home page? | `featured` | `false`. |
| 15 | Does it belong at a particular position in the catalogue, or may I pick an unused `order`? | `order` | An unused value (the catalogue uses tens, 10–95). Values must stay unique. |
| 16 | Which catalogue projects does it genuinely relate to? Does anything supersede it, or does it supersede anything? | `related`, `supersedes`, `supersededBy` | `[]` / unset. Every id must already exist in the catalogue. |
| 17 | What upstream work does it credit (a fork, a port, a library it is built on)? | `acknowledgments` | None. Only for derived work; include a URL. |
| 18 | GitHub Discussions is enabled — should the project page link it? | `discussions` | `false`; only `true` when Discussions is actually enabled. |

### Use cases (the story — always ask)

| # | Question | Decides |
| --- | --- | --- |
| 19 | Which audiences should this speak to — `developer`, `team-lead`, `architect`, `contributor`? Do not tag everything `developer`; a project with an adoption or architecture story should say so. | `useCases[].audience` |
| 20 | For each audience: **what situation is the reader in, and what do they get back?** | `useCases[].scenario`, `.outcome` |
| 21 | **What is the fact that proves it?** A before/after, a count, a generated output, a measured property — not "faster" or "easier". | `useCases[].evidence` |
| 22 | Which aggregated docs page backs each example? | `useCases[].docsPage` |

Aim for two to four strong examples, not one per audience. `code` requires `language`; the slug must
resolve to a real page under `/docs/<id>/` (see `use-case-authoring`).

### Upstream changes (ask before touching the product repository)

| # | Question | Decides |
| --- | --- | --- |
| 23 | Repository topics are missing or poor — they are the site's tag chips. May I set them? | tags (`check-projects` **fails** on no topics) |
| 24 | The description is thin — it backs the `shortDescription` fallback and social metadata. May I improve it? | `shortDescription` fallback, `og:` metadata |
| 25 | Is there a schema or artefact worth mirroring to a stable `purview.dev` URL (an `assets:` entry), or is it already published elsewhere? | `assets` |

## Rule 3 — the minimum question set

When recon answers everything else, this is the whole interview. Ask nothing more.

1. **Category** — confirm against the vocabulary (question 4).
2. **Experimental?** — yes/no (question 6).
3. **Use cases** — audiences, the situation/outcome, and one evidence fact each (questions 19–22).
4. **Relationships and credit** — `related`, `supersedes`/`supersededBy`, `acknowledgments`
   (questions 16–17).
5. **Curation** — `featured`, and whether `order` matters (questions 14–15).
6. **Upstream permission** — topics and description (questions 23–24).

Everything else is recon or a derived default. Ask the three identity/documentation/package
questions (3, 8, 10) **only when recon hit the failure mode that makes them ambiguous**.

## Rule 4 — how to ask

- **One decision per question**, phrased so the answer is a value, not a discussion.
- **Lead with the recommendation and its evidence**: "The packages publish a stable 1.1.0 and the
  repo is active, so I'll set `status: stable` — correct?".
- **Ask before assuming intent**: `experimental`, `featured`, `related`, `supersedes`,
  `acknowledgments`, and the whole use-case story are not derivable.
- **Never ask the human to decide something the guard decides**: versions, target frameworks, the
  docs file list, or whether the repository is archived.
- **If the human is unavailable**, take the recon-derived default, mark it in the report as an
  assumption, and list it as an open question rather than stalling the whole onboarding.

## Rule 5 — stop and ask instead of inventing

Stop and ask the human when:

- a use case cannot be evidenced from the repository (never write marketing prose);
- documentation does not exist upstream (configure `docs` for what exists, or leave it unset — do not
  fabricate pages);
- the repository is a collaboration that would need `externalProjects:` but the human expects a
  `/projects/<id>/` page;
- a `purview.dev/projects/<id>/` URL is already published for a different id;
- the release channel and the intended `status`/`experimental` disagree.

## Where each answer is checked

Answers become a record; the guard proves the mechanical ones. Confirm the judgement calls in the
report — no check will catch them.

| Answer | Guard (`just check-projects`) |
| --- | --- |
| `id`, `order` | duplicate id/order → **fail** |
| `name` | must slugify to `id` when `docs` is set → **fail** |
| `category`, `experimental`, use-case prose | not machine-checkable → **judgement; record it** |
| `status` | archived vs active repo, stable vs stable package → **fail**; preview with a stable package → **observation** |
| `docs` | no pages, non-`main` branch → **fail**; no landing page → **observation** |
| `packages` | duplicate id, >1 `primary`, unpublished package → **fail** |
| `targetFrameworks` | mismatch with the published nuspec → **observation** (`just fix-projects`) |
| `related`/`supersedes`/`supersededBy` | unknown id → **fail** (loader) |
| topics | none set → **fail** |
| `discussions` | `true` without Discussions → **fail** |

Finish the interview by handing the answers to `add-catalogue-project`, then run the validation loop
in `site-validation-loop`.
