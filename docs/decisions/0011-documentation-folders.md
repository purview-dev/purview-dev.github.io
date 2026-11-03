# 0011 — Documentation folders keep their place in the URL

- **Status:** Accepted
- **Date:** 2026-03-11
- **Supersedes:** none

## Context

Documentation used to be one flat directory per project, so a page's slug was its
file name. That works for a dozen pages and fails at thirty: a project cannot
group its pages by topic without the grouping existing only in the sidebar, and a
reader cannot tell from an address that `custom-rules` is part of validation
rather than a top-level concern.

Letting a project nest its pages exposed two assumptions that were invisible while
every corpus was flat:

1. **Slugs ignored the folder.** `slugifyDocFile` folded the whole path into one
   dash-joined slug, so `schemas/Custom-Rules.md` would publish at
   `/docs/zodsharp/schemas-custom-rules/` — the URL says the tree has a folder and
   then hides it.
2. **Links resolved from the docs root.** `rewriteDocMarkdown` matched a link by
   its *file name* against a set of root-relative slugs. A page in `schemas/`
   linking `../concepts/Core-Concepts.md` matched nothing, so the link degraded
   into a GitHub blob URL computed from the root — pointing at a path that does not
   exist.

## Decision

### 1. A page's folder is a path segment of its slug

`docSlug(path)` reduces each segment to lower-case ASCII letters, digits and inner
dashes and joins them with `/`, so `schemas/Custom-Rules.md` publishes at
`/docs/<id>/schemas/custom-rules/` and the mirror writes
`docs/<id>/schemas/custom-rules.md`. A folder is therefore supported without
restriction — `Topic Folder`, `Q&A` and `v2.guides` become `topic-folder`, `q-a`
and `v2-guides` — and only the file's own `.md`/`.mdx` extension is dropped.
`isUrlSafeDocSlug` is the contract every published slug must satisfy: non-empty
segments, no leading or trailing dash, nothing that would need percent-encoding. A
folder or file name that reduces to nothing (`___/Page.md`) fails the sync with a
`DocsValidationError` naming the source path, rather than publishing a page at an
address nobody can write down.

A flat corpus is the single-segment case of the same rule, which is why **no
existing URL moves**: `Getting-Started.md` is still `getting-started`, and a
project that never nests needs no changes.

### 2. Links resolve against the page that contains them

`DocLinkContext.pagePath` carries the page's doc-root-relative path, and a link is
resolved from that page's directory — the way GitHub and a browser resolve it.
A bare file name still resolves by name, so a flat corpus and a link written before
the folders keep working. Repository-path fallbacks resolve from the page's
*directory in the repository*, so `../../src/Foo` from a nested page still lands on
the right GitHub blob.

`<doclink:…>` placeholders now accept `/`, and `resolveDocRelativeLink` counts the
hops between two pages with `path.posix.relative` instead of assuming one `..`, so
`schemas/custom-rules` reaches `serialization/jsonschema-export` at `../../`.

### 3. A move is declared, and a redirect needs both ends

A page's folder is part of its URL, so reorganising a tree changes published URLs.
`docs.redirects` maps a former slug to its current one and the build writes a
meta-refresh redirect for each pair — but only when the pair is real in the build
at hand. `writeStaticRedirect` refuses to overwrite an existing file, so a redirect
never shadows a page that owns its URL; and `writeDocsPageRedirects` skips a pair
whose destination the channel has not published yet.

That second check is what makes a declaration timing-safe across a promotion. A
project that nests its pages changes every slug at once, while the `live` channel
keeps reading the last release tag until the next release is promoted: the old
slug is still a real page, so nothing is written. For a page that only exists in
the newer tree, the new address is unpublished too, so forwarding the reader would
be forwarding into a 404 — the post-build link crawl fails the build on exactly
that, which is how this was found. Both halves activate per page, at promotion.

A pair is emitted for every base the project publishes: the default channel at
`/docs/<id>/` and, when `live` and `prerelease` are both declared, the prerelease
channel at `/docs/<id>/prerelease/`. The reorganised tree is usually published on
the prerelease channel *first* — that is what a default-branch docs change is —
and its readers follow URLs that move at the same moment the default channel's
do later. The same two guards decide which pairs are real, so a withheld channel
still writes nothing here; its URLs belong to the retired-channel redirects.

### 4. The sidebar and the page show the tree the URL describes

Publishing a hierarchy in the URL and then flattening it in the sidebar would
leave the reader with the one thing folders were meant to fix: grouping that the
address disagrees with. So the display follows the slug:

- `buildChannelItems` nests a channel's pages into Starlight sidebar groups, one
  per folder, labelled with the folder's segment spelled out (`schemas` →
  `Schemas`, `json-schema` → `JSON Schema`). A group appears where its first page
  appears and absorbs its later pages, so a folder is listed once and the sync's
  reading order (`docs.order` / `_Sidebar.md`) survives.
- Nesting is recursive, because a slug is a path: `guides/getting-started/install`
  is a group inside a group. A folder's index file (`schemas/index.md`) is
  published at the folder's own address, so its sidebar entry links the folder.
- A flat corpus has no folder in any slug, so it produces no group and no code
  path changes for the projects that never nested.
- A page names its section above the title (`PageTitle.astro`), using the same
  spelling as the sidebar, so a reader arriving from search knows which part of
  the documentation they are in.

### 5. `docsPage` stays a single segment

The catalogue's deep-link slug keeps its `^[a-z0-9-]+$` shape and resolves against
the default channel. A deep link must therefore keep working across two trees that
can differ (a tag and a branch), so a page the catalogue deep-links either stays at
the docs root or moves together with its deep link. Widening the schema would only
move the failure to the moment a channel's tree diverges.

## Consequences

- The published URL mirrors the source tree, so a page's address says where it
  lives; moving a page between folders is a URL change and needs a `docs.redirects`
  entry.
- Sibling folders are reached with `../../`; the previous assumption of a single
  `..` is gone, and the recursion through `starlight-links-validator` is what
  catches a mistake in the built site.
- Documentation written for a flat corpus is unaffected in both slug and link
  terms, so this landed without touching another project's catalogue.
- ZodSharp's own move is the first user of `docs.redirects`: 30 entries that stay
  inert on the default channel until the release that carries the folders is
  promoted to `live`, and apply immediately to the prerelease channel, which reads
  the reorganised tree today.
- `buildChannelItems` returns a tree instead of a list. That is the only shape
  change the display took: `SidebarDocItem[]` replaced `SidebarSlugEntry[]`, and
  every other use of the docs cache (`llms` bundles, discovery resources, the docs
  portal) still reads the flat page list, which remains the source of truth for
  what a channel publishes.

## Alternatives considered

- **Fold the folder into the slug** (`schemas-custom-rules`). One-line change, but
  the URL then advertises a hierarchy it does not express, and `/` is what a
  reader expects to see. Rejected.
- **Keep resolving links from the docs root.** Requires every cross-folder link to
  be written root-relative, which breaks on GitHub and in any editor that resolves
  relative paths. Rejected in favour of resolving from the page.
- **Redirect every nested page from its flattened slug automatically.** Would have
  avoided the `docs.redirects` map, but it also invents URLs for pages that never
  had them (`/docs/<id>/setup/` for a page that was always `guides/setup`) and
  cannot express a rename. Rejected in favour of an explicit map.
- **Allow `/` in `docsPage`.** Rejected: see decision 4 — a deep link that exists
  in one channel's tree and not the other fails the build either way, and the
  schema is the cheapest place to make that impossible.
