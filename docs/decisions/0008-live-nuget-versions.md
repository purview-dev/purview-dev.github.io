# ADR 0008 — Live NuGet versions in the browser

- Status: accepted
- Date: 2026-10-16

## Context

ADR 0001 (decisions 2 and 4) makes the site fully static: all external data is fetched once during
the build, and the visitor's browser never queries GitHub or NuGet. That keeps the site fast,
token-free, and identical for every visitor, and it remains the right default for almost everything
the site shows.

A NuGet version is the exception. It changes without any change to this repository, and it changes
at exactly the moment a product release completes — which is independent of when this site is
deployed. Because the version is baked into the HTML, a package published minutes after a deploy
stays invisible on the home-page snapshot, the releases table, the project page, and inside the
copy-paste install snippets until the next deploy. The site routinely advertises a version one
release behind, and the fix is a redeploy of a site that did not change.

The build already reads this data from the NuGet flat-container index
(`https://api.nuget.org/v3-flatcontainer`), and both the flat-container and the search endpoints send
`Access-Control-Allow-Origin: *`. The browser can therefore read the same source directly, with no
proxy, no server, and no credential.

## Decisions

### 1. Version numbers are hydrated, never replaced

Every page still renders the build-time version into the HTML. The browser applies any stored copy
immediately, then re-checks NuGet in the background. A visitor without JavaScript, or without
network access, sees exactly what the build produced — the site degrades to the ADR 0001 behaviour
rather than to an empty table.

### 2. A live version may only raise the displayed version

The build reconciles GitHub release tags into the NuGet candidate list
(`reconcileWithGitHubReleases`), so the build-time value can legitimately be ahead of the
flat-container index — `Purview.EventSourcing` currently shows stable `1.1.1` from a release tag
while NuGet publishes only `2.0.0-prerelease.x`. The browser therefore replaces a version only when
the live one is strictly higher (`preferNewer`). A version a visitor is looking at never moves
backwards.

The withholding rule is re-applied to the merged pair, not per channel. Because the build can be
ahead of NuGet, a merge can raise the stable release past a live prerelease that used to outrank it,
or pair a live prerelease with a build-time stable it trails; either way the prerelease must stay
withheld, or the page would advertise a trailing prerelease beside a newer stable release.

### 3. One stored cache, stale-while-revalidate, six-hour TTL

Fetched versions are stored in `localStorage` under `purview.live-nuget-versions.v1`, keyed by
package id, with a schema version and a fetch timestamp. The stored copy is applied instantly; a
fetch runs only when the copy is missing or older than six hours. Concurrent islands on one page
share a single request per package set, and a stored copy is merged rather than overwritten so a
package that could not be fetched keeps its last value.

### 4. Every surface that shows a NuGet version refreshes

The releases package table, the project-page package table, the home-page project snapshot, and the
version pinned inside the install snippets. The install snippets are included deliberately: a table
that says `1.1.0` beside a copy-paste command that says `1.0.6` is worse than a uniformly stale
page. The GitHub release cards, download counts, repository topics, documentation, `llms*.txt`,
`discover.json`, and the sitemap stay build-time — they are content and discovery artefacts, not a
moving version number.

### 5. One module owns the behaviour

`src/src/lib/releases/live.ts` is isomorphic and free of Node APIs: the cache read/write, the fetch,
the version maths (`latestFromVersions`, `preferNewer`, `mergeVersionPair`, `rollupPackageVersions`),
the shared tooltips, and the status message. The Preact islands and the home-page script all use it,
so the server-rendered value and the refreshed value are computed by the same code.

### 6. Failures are silent and non-destructive

A package that cannot be fetched is simply absent from the result; a total failure leaves the stored
copy — or the build-time value — in place and the page renders exactly as built. There is no retry
storm, and no error state that hides data.

## Consequences

- A published package version appears on the site within one page view, without a redeploy.
- The browser now makes an unauthenticated request to `api.nuget.org` that carries no visitor data,
  at most once per package set per six hours.
- `live.ts` is the first module shared between the server render and a browser script. It must stay
  free of Node imports and of anything that would pull `manifest/load` or the filesystem into the
  client bundle.
- The home page gains a small bundled script; the snapshot table itself is unchanged and remains
  island-free. Version-badge styling moved into `.pv-version-badge` in `global.css` so the script
  can swap a version by setting a single `data-version` attribute.
- Machine-readable outputs (`llms.txt`, `discover.json`, the sitemap) remain build-time and can
  therefore report a version one release behind, because crawlers do not run the script. That is
  acceptable, and it is why the human-facing surfaces are the ones that refresh.
- `AGENTS.md`, `README.md`, and the `github-repo-metadata` and `site-validation-loop` skills record
  the exception: external data is fetched at build time *except* the NuGet version numbers the
  browser re-checks.
