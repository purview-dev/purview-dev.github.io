# ADR 0013 — Project-owned catalogue records

- Status: accepted
- Date: 2026-11-15

## Context

ADR 0005 split the catalogue into one file per project, `src/src/data/projects/<id>.yml`, and the
split worked: a project's history and review are self-contained, and two concurrent additions no
longer conflict. What it did not change is **who owns the words**.

Every one of those files is written and reviewed here, in `purview-dev/purview-dev`, by the site
maintainers, while the project it describes lives in another repository and moves without asking.
That is a drift engine with no detector: `zodsharp`'s record still listed `net8.0` and `net9.0` two
releases after the project dropped them, and its `status`, `docs.channels` and package descriptions
are all facts the project knows better than the site does. Correcting any of it is a cross-repository
pull request, which is exactly the friction that makes a record stale in the first place.

Everything else the site reads for a project is already pulled from the project at build time — the
release data, the documentation tree, the agent skills, the mirrored assets — each with a cache under
`src/.cache/` and a committed fixture under `src/fixtures/` as the offline fallback. The catalogue is
the one input that is still copy-pasted in.

## Decisions

### 1. `.config/purview-docs.yml`, published by the project

A project repository publishes its catalogue record at `.config/purview-docs.yml`: the same record,
the same fields, one file, no wrapper. A repository that publishes the file is a catalogue project;
a repository that does not is not one, and no list anywhere else says which is which.

### 2. Discovery is the organisation's repository list

`sync-manifests` lists the `purview-dev` organisation's repositories (one API call, paged) and tries
`raw.githubusercontent.com/<owner>/<repo>/<default-branch>/.config/purview-docs.yml` for each. A 404
is not an error: it means that repository is not a catalogue project. Adding a project to the site is
therefore one file in the project's repository and no pull request here; removing it is deleting the
file.

The record is read at the **default branch**, the same source and ref the documentation mirror uses,
so the site shows what the project actually publishes rather than what a pull request once said.

### 3. A project's record wins, and the clash is reported

`readRawManifest()` still reads `src/src/data/projects/*.yml`, and merges the project-owned records
over them: same id means the owner's record wins. This is the migration path — moving a record is a
change in the project repository plus the deletion of the local copy — and it means a project with no
published record keeps working exactly as before.

The clash is not silent. `readRawManifest()` reports the ids declared twice, and `just check-projects`
prints an observation naming the local file to delete. It is an observation rather than a blocker
because the move is two pull requests in two repositories and the site must not fail in the gap
between them.

### 4. `.config/` rather than a top-level file

The record is site plumbing, not project source, and `.config/` is where a project already keeps its
other tool configuration (`lefthook.yml`, `dotnet-tools.json`, `purview-build.json`). One file, one
purpose, out of the way of the project's own documentation.

### 5. The same cache and fixture model as the release data

`sync-manifests` writes `src/.cache/manifests/manifests.json`, and `just refresh-fixtures` writes
`src/fixtures/manifests/index.json`. `getManifestIndex()` reads the cache, then the fixture, and
never performs network I/O, so rendering is unaffected and an offline build still resolves the whole
catalogue. `DATA_MODE` selects the source exactly as it does for releases: `live` always fetches,
`cache` and `fixture` never do, and `auto` prefers the cache.

The fixture is a snapshot, not a second source of truth: a record that changed in its project
repository is picked up by the next `just data-sync` (or `just refresh-fixtures`).

### 6. The `$schema` hint stays advisory

The record may open with a `$schema` pointing at this repository's schema module. It is an editor
affordance, as ADR 0005 §5 says, and the enforcing validation remains `loadProjects()` here plus
`just check-projects`. A project-owned record names the schema by absolute URL, because the relative
path it used to carry resolves to nothing from another repository.

### 7. Validation failures name the owner

`parseManifest()` takes the provenance of each record, so a failure reads
`projects[zodsharp] (purview-dev/zodsharp (.config/purview-docs.yml at main))` rather than naming a
file that does not exist here. A schema error in a project-owned record is a build failure with the
repository named: the project owns the record, so it owns fixing it.

## Consequences

- The catalogue is complete without this repository holding any project's words. What is left here is
  `src/src/data/external-projects.yml` (collaborations, which are not ours to own) and the records of
  projects that have not migrated.
- Editorial fields — `status`, `featured`, `order`, `category`, the docs channels and the redirects —
  move to the project with the rest of the record: the record is the project's, whole.
- The site's build now depends on files it does not control. A malformed record fails the build with
  the repository named, and the fetch reports *every* unreadable record at once rather than skipping
  it, because a catalogue that silently lost a project is worse than a failed build.
- `just fix-projects` can no longer auto-fix a project-owned record: the observation is printed with
  the repository to edit, and the write to a local file is skipped.
- Discovery is organisation-wide, so a new repository that publishes a record appears on the site on
  the next build. That is the intent: the organisation's repositories are the catalogue's scope.
- The record is read at the default branch while the documentation mirror still honours per-channel
  refs (`docs.channels`), so a project that publishes docs from a tag keeps its record at the head of
  the branch.
