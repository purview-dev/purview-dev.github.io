# ADR 0004 — Mark exploratory projects with an orthogonal `experimental` flag

- Status: accepted
- Date: 2026-09-30

## Context

The catalogue's `status` field answers one question: which release channel does a project publish on,
and is it still maintained? `stable` means a stable release exists and the project is recommended;
`preview` means prereleases only; `archived` means the repository is archived and the project is no
longer developed. `src/scripts/check-projects.ts` ties that field to observable reality — the GitHub
`archived` flag and the NuGet version list — so it cannot be used as free-text marketing.

There is a second, independent thing a reader needs to know: **intent**. A project can be entirely
exploratory — "the API, defaults and packaging will change between prereleases, and there is no
production support guarantee" — while being honestly described by `preview`: it is actively
developed, publishes prereleases, and has documentation. The first project in this situation
(`containers`, whose README opens with an explicit *Experimental* caveat) would be *described*
accurately by `preview` but not *warned about* at all.

Adding a fourth `status` value (`experimental`) was considered and rejected. It would force one
field to answer two orthogonal questions, so the guard would have to decide what
"`experimental` with a stable NuGet version" and "`experimental` on an archived repository" mean,
and every vocabulary-enumerating surface would inherit a four-value lifecycle. The release channel
and the maturity promise genuinely are different axes, so they are modelled as different fields.

## Decisions

### 1. `experimental` is an optional boolean on `projects[]`

Every catalogue record (`src/src/data/projects/<id>.yml`, see ADR 0005) gains an optional
`experimental: true` (default `false`, applied by the loader). It is only valid on `projects[]` —
collaborations in `externalProjects.yml` are not ours to label. `status` keeps its existing
three-value vocabulary and its existing meaning; no value is added or redefined.

### 2. The two axes collapse into one *display* status in exactly one place

`src/src/lib/status.ts` owns `displayStatus()`, which resolves `{ status, experimental }` into
`stable | preview | experimental | archived` for presentation. The precedence is deliberate:

- `archived` wins over everything (an archived project is never presented as an experiment);
- otherwise the `experimental` flag wins over the release channel, because the warning is the point.

Every surface that renders a badge, filters, or labels a sidebar topic calls that helper rather than
re-deriving the rule, so the catalogue card, project page, home-page version snapshot, docs page,
docs sidebar topic and catalogue filter cannot disagree.

### 3. `experimental: true` with `status: archived` is a schema error

The combination is contradictory: an archived repository is not an ongoing experiment. It is
rejected by a refinement in the manifest schema (`src/src/lib/manifest/schema.ts`), so it fails at
load time for every consumer — the build, the guard, and the unit tests — with a remediation
message rather than at render time.

### 4. `experimental` with a stable release is legal but reported

The flag is an intent marker, not a release-channel marker, so the guard does not invent a rule such
as "experimental must not have a stable version": a project may legitimately ship `1.x` while still
being flagged as an experiment. `just check-projects` emits a **warning** (not a failure) so the
combination is a conscious decision rather than an oversight.

### 5. Experimental projects are surfaced, not hidden

Only `archived` removes a project from the catalogue, the documentation portal, the sidebar topics
and the per-project LLM bundles. An experimental project with documentation is aggregated, listed,
indexed by `/use-cases/`, included in `/releases/`, and gets its `/_llms-txt/<id>.txt` bundle like
any other project. Discoverability with an explicit warning is the point of the flag.

### 6. The flag is presented on the project page and on every documentation page

A distinct badge (`.pv-status-experimental`) is not sufficient on its own, so the warning is also
stated in prose: the project page renders an "Experimental" notice above the content, and
`src/src/components/starlight/PageTitle.astro` renders one on every aggregated documentation page,
driven by the injected front matter. The aggregated docs mirror stays generated — the notice is
injected by the site, never hand-authored into `src/src/content/docs/**`.

### 7. Promotion is a manifest edit

Removing `experimental: true` (and correcting `status`) is the promotion mechanism; nothing else has
to change for a project to graduate. An experimental project is expected to end in one of the two
defined states — promoted, or `archived`.

## Consequences

- `status` stays a closed three-value vocabulary tied to the release channel, and the guard's
  existing rules (`archived` ⇔ repository archived, `stable` ⇒ stable NuGet release) are untouched.
- Two axes create combinations that a single field could not: the schema forbids the contradictory
  one and warns about the ambiguous one, rather than leaving them undefined.
- The documentation front matter carries the raw pair (`status` plus `experimental`) and not a
  pre-collapsed value, so the manifest remains the only place the vocabulary is defined; the
  display collapse happens in the site components through `displayStatus()`.
- Adding an experimental project still requires one concrete use case (ADR 0002 applies to every
  non-archived project).
