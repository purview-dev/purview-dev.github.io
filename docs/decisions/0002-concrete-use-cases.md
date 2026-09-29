# ADR 0002 — Surface concrete, audience-tagged use cases in the catalogue

- Status: accepted
- Date: 2026-09-29

## Context

The site explains what Purview is and why each project exists, but a reader
arriving without context could not see what the tools actually do. Feedback on
the beta was consistent: it is not obvious what it does depending on the
audience, a few examples/use cases would help, and the audience — even one
already aware of the organisation — still needs concrete evidence.

The project manifest already carried `description`, `origin`, `useWhen`, and
`avoidWhen`, but these are prose. The concrete examples that existed — dozens of
code fences across the aggregated documentation — were only reachable after a
click into the portal, and were written as reference material rather than as
proof.

## Decisions

### 1. Model use cases in the catalogue, not in a separate content store

Every project gains an optional `useCases` array in `src/data/projects.yml`,
validated by the Zod manifest schema. A use case is audience-tagged
(`developer`, `team-lead`, `architect`, `contributor`) and carries a `title`,
`scenario`, `outcome`, optional `code` + `language`, optional `evidence`, and an
optional `docsPage` deep link. Keeping this in the single source of truth means
the catalogue, project page, and use-case index cannot disagree, and the schema
enforces the shape at build time.

### 2. Snippets are short and point at the documentation for depth

Use cases carry a short taste of the code and an `evidence` fact (a before/after,
a count, a generated-output excerpt, or a measured property such as ZodSharp's
zero-allocation valid path). Long examples stay in the aggregated documentation
so there is one copy of them; the card links into `/docs/<project>/<docsPage>/`.

### 3. Deep links are validated by the link crawl

`docsPage` slugs are rendered into `/docs/<project>/<docsPage>/` links. The
post-build crawl (`just check-links`) fails the build when a link does not
resolve, so a renamed documentation page cannot leave a dead link behind. A unit
test additionally rejects a `docsPage` on a project that publishes no
documentation.

### 4. Render server-side, enhance with one small island

Use cases are rendered as static HTML on the home page, project pages, and
`/use-cases/`. A single Preact island (`UseCaseFilter`) toggles visibility on
the index page only; the page is fully usable without JavaScript, consistent
with the existing catalogue and release filters.

### 5. Highlight code at build time with Shiki

Code samples are highlighted at build time by Astro's built-in `<Code>`
component, which wraps Shiki. This keeps the marketing pages consistent with the
documentation (Starlight's Expressive Code uses Night Owl) and ships no client
JavaScript. The theme is passed as an imported object (`@shikijs/themes/night-owl`)
rather than a Shiki theme name, because Astro's bundled Shiki theme registry
resolves to an empty map in this build and a string name — even the default —
throws "not included in this bundle". One CSS rule makes the frame's
brand-tinted background show through instead of the theme background, so the
highlighted samples and the un-highlighted install panel share the same surface.

## Consequences

- Adding a project now includes writing at least one concrete use case; the
  manifest test suite asserts coverage across projects.
- The audience vocabulary is deliberately small and lives in the schema; adding
  an audience is a schema change, so it is a considered decision rather than a
  free-text label.
- Use cases are hand-authored prose-plus-code in YAML. This is acceptable for the
  current catalogue size; if it grows substantially, snippets could move to files
  referenced by path without changing the rendered shape.
