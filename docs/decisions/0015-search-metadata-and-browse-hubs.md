# ADR 0015 — Search metadata derived from the catalogue, and browse hubs

- Status: accepted
- Date: 2026-11-16

## Context

ADR 0007 made the site *discoverable*: a partitioned sitemap, `robots.txt`,
per-project `llms.txt` bundles, `discover.json` and IndexNow. Crawlers could find
every URL, and they did. What they could not do was decide that any page answered
a question, because:

1. **Titles were the page's own name.** A documentation page titled
   `Union design | Purview Dev` omits the product it documents; a project page
   titled `Unions — Purview Dev` omits every word a reader searches with. The
   catalogue already knew those words (`shortDescription`, the package id, the
   GitHub topics, the category) and used none of them in metadata.
2. **`og:type` was set globally to `website`** in the Astro config's `head`
   array, which overrides the `article` Starlight emits for a documentation page.
3. **Every internal link into the documentation carried the same anchor text**
   (`Read the guide →`), discarding the strongest on-page signal a docs page has.
4. **There was no browse surface.** The catalogue's metadata produced 17 project
   pages and the docs mirror; a reader searching "c# source generator",
   "value types" or "aspire" had no destination, and `/projects/` filtering is
   client-side, so it is not a crawl path.
5. **The tags were decorative.** GitHub topics were rendered as chips on the
   project and documentation pages and linked to nothing.

The only structured data was a minimal `SoftwareSourceCode`/`TechArticle` pair,
and NuGet — the highest-authority place the packages appear — renders its links
`rel="nofollow"`.

## Decisions

### 1. Search metadata is derived from the catalogue, never hand-authored

`src/src/lib/seo.ts` builds every `<title>` and meta description from the
catalogue and the release cache:

- a project page leads with the **product** (the primary package id) and the
  keyword phrase taken from `shortDescription`;
- **a documentation page always names its project**, and the folder a page lives
  in (ADR 0011) is part of the title and of the breadcrumb, because it is part of
  the URL;
- a non-default documentation channel adds its version label, so the two versions
  of one page never share a title (ADR 0009);
- descriptions prefer a sentence boundary when they must be truncated, instead of
  ending mid-word with an ellipsis.

The **visible H1 does not change**: the title is composed where every other piece
of search metadata is (`src/src/components/starlight/Head.astro`), from the
catalogue, the docs manifest and the page itself. The docs mirror therefore stays a
mirror of the *documentation* — it carries no site metadata — and a title change
needs no documentation re-sync. Starlight's own `<title>` is replaced, not appended
to, so no page can end up with two.

Every derived title is budgeted to what a result actually shows (70 characters
including the brand, enforced by unit tests over the real catalogue). The parts are
dropped, or trimmed at a word boundary, in this order: the folder trail, the word
"documentation", then part of the page title. Nothing is ever dropped that
identifies the page — the project name in a documentation title, the product name
in a catalogue title — because a title that has lost its subject has lost the
reason to rank; and a shape is only shortened when the shortened form still fits,
so two pages never collapse onto one title.

### 2. Browse hubs are generated from the same metadata

`src/src/lib/hubs.ts` derives:

- `/topics/<topic>/` from GitHub repository topics;
- `/categories/<category>/` from the catalogue's `category` vocabulary;
- `/packages/` from every declared package.

Every hub lists the real projects (status, description, documentation link) and
the documentation pages behind them, so the page has content of its own. A hub is
**only published when it indexes at least two projects** (`MIN_HUB_PROJECTS`):
one-link hubs are the doorway pages search engines devalue, and a topic only one
project carries is better served by that project's page.

Hubs are ordinary Astro pages, so they enter the sitemap, `discover.json`,
`robots.txt` and the IndexNow diff through the existing discovery model
(ADR 0007) with no extra registration — but they are a **new URL family**, hence
this ADR.

### 3. `og:type` is never set globally

The site's own pages set `website` themselves in `SiteLayout`; documentation pages
keep Starlight's `article`. A global value in the config silently wins over both.

### 4. Structured data describes the entity, not the template

- Documentation pages: `TechArticle` (with `keywords` from the repository topics,
  `articleSection` from the folder trail, `dateModified` from `lastReviewed`,
  `mainEntityOfPage`) plus a `BreadcrumbList` that mirrors the visible structure.
- Project pages: `SoftwareSourceCode` **and** `SoftwareApplication` (free offer,
  `downloadUrl`, `softwareRequirements` from the declared target frameworks) plus
  the existing `BreadcrumbList`. Assertions are made only when true: a project
  with no NuGet package is not given `programmingLanguage: C#`.
- Hubs: `CollectionPage` + `ItemList` + `BreadcrumbList`.

### 5. Internal anchor text names its destination

A use case links to a documentation page by name ("Read Union design"), and a
topic chip becomes a link to its hub whenever that hub exists. The set of tags
with hubs is computed once (`getHubs()`), so a chip can never point at a 404.

### 6. `lastmod` sources are derived, not listed

`PAGE_SOURCES` was a hand-kept map of six routes. Any page not in it — the
`/examples/astroc4/` demo page, and every page added since — silently fell back to
the release cache's retrieval time, which is the build time, which is the one
signal ADR 0007 forbids. The index is now built by walking `src/src/pages`
(workspace-root-relative, so keys still match `git log`), with `[param]` routes
matched by pattern.

### 7. The rules are enforced against the built output

`bun run check:seo` (`src/scripts/check-seo.ts`) runs over `dist/` and fails on
structural violations: not exactly one `<h1>`, a missing or duplicated `<title>`,
a missing description, a canonical that is not self-referencing, `noindex` on an
indexable URL, a documentation title that does not name its project, invalid or
missing JSON-LD. Title and description *lengths* are advisories only, printed and
never fatal — a rule that fails on taste is a rule that gets weakened (ADR 0001).

### 8. Off-site signals are a repository responsibility, recorded in the skills

`purview.dev` has no followed inbound links except the GitHub **Website** field of
each repository, and those point at `/projects/<id>/` only. NuGet's project URL
and README links are all `rel="nofollow"`. The consumer skills
(`purview-site-integration`, `purview-site-docs`) therefore require a product
repository to link its published pages, and the assessment skill reports when it
does not — the one part of SEO this repository cannot do for itself.

## Consequences

- Titles change once; previously indexed pages will be re-crawled under their new
  titles. Canonicals are unchanged, so no URL moves.
- The sitemap gains a page per shared topic and category, plus `/packages/`.
  `discovery:validate` and `check-links` cover them without modification because
  they come from the same discovery model.
- A project onboarding now also creates hub memberships; a project whose topics
  are poor (fewer than two shared) contributes to no topic hub, which makes the
  existing "set real GitHub topics" intake question more consequential than it was.
- `check:seo` joins `just validate`, so a page that loses its title, its canonical
  or its structured data fails the build rather than the ranking.

