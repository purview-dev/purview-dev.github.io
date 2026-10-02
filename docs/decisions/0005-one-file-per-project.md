# ADR 0005 — One file per project for the catalogue manifest

- Status: accepted
- Date: 2026-09-30

## Context

ADR 0001 established a single YAML manifest, `src/src/data/projects.yml`, as the source of truth for
the catalogue. By the time this was written it held twelve projects and one collaboration in 1,037
lines / 47 KB, and it grows by roughly 80–140 lines per project — one project per pull request. Every
addition appends to the same region of the same file, so two concurrent catalogue pull requests
conflict almost by construction, and `git log`/`blame` attribute a change to "the manifest" rather
than to a project.

The decision recorded here is not that the single manifest was wrong. It is that the *granularity of
the file* no longer matches the granularity of the change.

## Decisions

### 1. `src/src/data/projects/<id>.yml`, one file per project

The file name is the project id. Each file holds the project record itself — no `projects:` wrapper —
so the file *is* the project. `$schema: ../../lib/manifest/schema.ts` opens the file, as before.

### 2. Collaborations stay in one file: `src/src/data/external-projects.yml`

`externalProjects:` remains a list in a single file. It is small, it changes rarely, and the entries
are not ours to grow.

### 3. The loader assembles the files; the validation does not move

`readRawManifest()` reads the directory (sorted by file name, so the result is deterministic whatever
order the filesystem reports) plus the collaborations file, and returns the same raw shape as
before (`{ projects, externalProjects }`). `parseManifest()` then validates that shape exactly as it
did, so every existing invariant — purview-dev ownership, unique ids, known relationship targets,
package uniqueness — and the `just check-projects` guard are untouched. Reading and validating stay
separate concerns, and `parseManifest()` remains the single validation entry point (still unit
testable with inline objects).

### 4. A schema failure names the project, not the array position

Splitting the file would otherwise degrade schema errors to `projects[3].name`, which the author has
to map back to a file. `parseManifest()` resolves the index to the record's `id`, so messages stay
`projects[<id>].name`.

### 5. The `$schema` hint is treated as a hint

A project record may declare `$schema`, and the loader strips it before resolution: it is an editor
affordance, never part of the domain type. `manifestSchema.projects` is defaulted to `[]` so the
collaborations file is valid on its own. The hint is advisory — there is no editor schema wiring in
this repository, and the enforcing validation is `loadProjects()` plus `just check-projects`.

### 6. The move was made by construction, not by re-serialisation

The split was a text transform that removed only the list indentation, and it was proved by
comparing the fully resolved catalogue before and after the change: byte-identical. Re-serialising
the YAML would have reformatted every hand-wrapped block scalar and code sample.

## Consequences

- Adding a project is one new file: unconflicted in review, and correctly attributed by
  `git log`/`blame`.
- ADRs 0001–0004 reference `src/src/data/projects.yml` for the manifest; read those paths as this
  layout.
- Cross-file invariants (duplicate `id`, duplicate `order`, a package id declared twice) can no
  longer be seen by reading one file, so the guard matters more rather than less.
  `just check-projects` is the authority for them and is unchanged.
- The migration was a fixed cost (loader plus documentation references); it does not recur.
