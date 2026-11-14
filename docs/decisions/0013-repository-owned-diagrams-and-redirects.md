# 0013 — Repository-owned diagram pairs, redirects and integration skills

- **Status:** Accepted
- **Date:** 2026-11-14
- **Supersedes:** none

## Context

Three gaps showed up as more repositories reorganised their documentation for the portal:

1. **Diagrams had no good form.** GitHub renders Mermaid but shows LikeC4 as source; the portal renders
   LikeC4 (through astroc4) and Mermaid. Repositories fell back to ASCII art (`pm-skills`' "The loop",
   the engineering playbook's architecture sketches) or to Mermaid source inside a ```` ```text ````
   fence, which neither side draws. A ```` ```likec4 ```` fence in a mirrored page renders here but is
   unreadable on GitHub.
2. **A moved page needed a pull request on this repository.** `docs.redirects` lives in the catalogue,
   so the commit that moves a page and the record that keeps its old URL alive land in two
   repositories, usually at different times — and in practice the second one is forgotten. The
   playbook and build-sdk moved most of their pages into topic folders with redirects for only one.
3. **The rules were only written down here.** The `.agents/` skills describe the portal to agents
   working *in this repository*. An agent in a product repository had nothing to install that told it
   how to lay out documentation for the portal, and no way to check the result.

## Decision

1. **Diagram pairs.** A product page marks a Mermaid fence as the GitHub rendering of a LikeC4 view
   with a pair of HTML comments:

   ```markdown
   <!-- purview:likec4 file="./diagrams/the-loop.c4" view="theLoop" title="The loop" -->
   …a ```mermaid fence, and optionally a link to the model…
   <!-- /purview:likec4 -->
   ```

   GitHub hides the comments. The docs sync (`src/lib/docs/diagrams.ts`) replaces the whole block with
   a ```` ```likec4 ```` fence whose body is the `.c4` file, read from the repository at the channel's
   ref, so the portal shows only the LikeC4 view. The model is one self-contained file per diagram,
   because astroc4 compiles a fence on its own. A block whose model is missing or lacks the view keeps
   its Mermaid and the sync logs why: an upstream mistake costs fidelity, never the page or the build.
   Markers inside code fences are ignored.
2. **`_redirects.yml` in the docs root.** A repository records its own moves as `previous: current`
   pairs (slugs, or Markdown paths from the docs root). The sync reads it at each channel's ref and
   stores the pairs on that channel in the docs cache; the build writes them from that channel's own
   base (`/docs/<id>/` or `/docs/<id>/prerelease/`), under the same guards as `docs.redirects`: a
   redirect is written only when its destination is published and never shadows a real page. The
   catalogue's `docs.redirects` stays and wins on a conflict. An unreadable file fails the sync
   (`DocsValidationError`) — silently dropping it would 404 every URL it was written to keep; a pair
   that points nowhere is an advisory.
3. **Consumer skills, published from this repository.** `skills/` at the repository root holds skills
   for product repositories, installed with `npx skills add purview-dev/purview-dev`:
   `purview-site-integration` (what the portal reads and the catalogue contract), `purview-site-docs`
   (hierarchical layout, diagram pairs, redirects) and `purview-site-assessment` (a dependency-free
   Node script plus a procedure that reports departures and proposes fixes). The `.agents/` skills
   remain the internal ones for working on the site.

## Consequences

- Documentation guidance that told authors to put Mermaid in a ```` ```text ```` block (the
  engineering playbook's *Documentation Convention*) is superseded: both renderers draw Mermaid, and
  the pair adds LikeC4 for the portal. That page is updated upstream, in its own repository.
- The assessment script mirrors the sync's slug, diagram and redirect rules. When those rules change in
  `src/lib/docs/`, the script and `purview-site-docs` change in the same pull request.
- The docs cache gains an optional `redirects` per channel. No schema bump: an older cache simply has
  none until the next `just data-sync`.
- Product repositories can move pages without touching this repository, and the existing catalogue
  `docs.redirects` entries can migrate into their repositories over time.
