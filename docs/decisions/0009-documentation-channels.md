# 0009 — Documentation channels (`live` and `prerelease`)

- **Status:** Accepted
- **Date:** 2026-03-11
- **Supersedes:** none

## Context

The documentation portal aggregates each project's documentation from the
repository that owns it. Until now every page came from branch `main`, which is
only correct while `main` describes the most recently released version.

That is no longer true for every project. ZodSharp is the clearest example: the
latest published release is `v2.4.2`, while `main` already carries the
`v3.0.0-prerelease.N` line. A reader who installs `2.4.2` and reads
`/docs/zodsharp/` is being shown API that does not exist in their package. The
same applies to any project that ships fixes on a release branch while `main`
moves on.

The obvious workaround — pin every project's docs to a tag — is wrong in the
other direction: a project with no stable release (a preview-only tool) must
publish from `main`, and even a released project's readers benefit from seeing
what is coming. The portal needs **two views**, and it needs to know which one
is canonical.

## Decision

A project may publish **up to two documentation channels**:

| Channel | Content | URLs |
| --- | --- | --- |
| `live` | The latest **non-prerelease** release — what a reader can install today | `/docs/<id>/…` (canonical) |
| `prerelease` | The line that has not shipped yet | `/docs/<id>/prerelease/…` |

### 1. The default channel owns the existing URLs

The default channel is `live` when it is declared, otherwise the only declared
channel. It is served at `/docs/<id>/…` exactly as before, so no existing URL
moves: use-case deep links (`docsPage`), the project page's Documentation link,
`llms.txt` entries, sitemaps, external inbound links, and the AGENTS invariant
that the display name slugifies to the project id all stay valid. A
prerelease-only project therefore serves its prerelease docs at the canonical
URLs — there is no second view to switch to.

A non-default channel is addressed by its channel id as one path segment. The
segment is the channel, not the version: `/docs/zodsharp/prerelease/…` keeps
working as the prerelease moves from `3.0.0-prerelease.2` to `.3` to `3.0.0`,
and needs no redirects. The version is stated on the page, where it belongs.

### 2. The manifest declares the intent; the sync resolves it

"Is `main` a prerelease?" is not observable offline, and guessing would
silently publish the wrong documentation. The manifest therefore declares the
channels and the ref each one follows:

```yaml
docs:
  source: github-path
  path: docs/wiki
  rootPage: Getting-Started.md
  channels:
    live:
      ref: latest-stable    # token → newest non-prerelease release tag
    prerelease:
      ref: default          # token → the repository's default branch
```

`ref` accepts `default`, `latest-stable`, `latest-prerelease`, or any
branch/tag/commit used verbatim. Resolution is deterministic against the
release cache (`lib/docs/channels.ts`), and a channel may restate `path`,
`rootPage`, `exclude`, `order` or `readmeAsIndex` because a tag's tree can
legitimately differ from `main`.

Omitted `channels` keeps the historical behaviour: one `live` channel on the
default branch. That is the case for every project that has not declared
channels, and it produces no channel UI at all.

### 3. Degradation is defined, not accidental

- `latest-stable` with no stable release → the live channel follows the default
  branch and the sync says so.
- `latest-prerelease` with no prerelease tag → the channel is skipped.
- A stable release that catches up with the prerelease line → the `prerelease`
  channel is withheld automatically (see 4). The declaration stays, so the
  channel returns with the next prerelease.
- Two channels resolving to the same ref → the non-default one is dropped, so a
  promoted prerelease cannot publish a byte-identical second copy.
- A declared channel that yields no pages → skipped (with a warning); the
  default channel is always kept, because a project must never lose its docs.

### 4. Promotion is automatic

Promotion is decided by the deploy build from published release data, never by a
manifest edit. A prerelease channel is published only while its line is **ahead**
of the newest stable release; `lib/docs/channels.ts#prereleaseLinePromoted`
computes that from the highest stable and prerelease versions across GitHub
release tags **and** NuGet package versions (a package can ship before its GitHub
release, and a repository can tag a release whose packages follow). When
`3.0.0` is published, `3.0.0-prerelease.2` no longer outranks it, so the channel
is withheld on the next build even though `docs.channels.prerelease` is still
declared. It returns by itself when the project cuts its next prerelease.

This is what makes a GitHub-only deploy safe: nobody has to clone the site,
delete a line, and open a pull request to stop publishing documentation for a
version that shipped. `just check-projects` treats a withheld channel as an
observation ("not published: stable 3.0.0 has caught up with 3.0.0-prerelease.2;
nothing to do") rather than drift, and warns if a channel is published while its
line is already retired (a stale mirror — re-sync).

### 5. Retired URLs redirect to the live release

A withheld channel must not turn its pages into 404s for readers following a
bookmark. Because purview.dev is served from GitHub Pages (static files only, no
redirect configuration), the build writes a meta-refresh page for every withheld
channel URL — `/docs/<id>/prerelease/` and each
`/docs/<id>/prerelease/<page>/` — pointing at the live page with the same slug
(`lib/docs/redirects.ts`, run by `config/docs-redirects-integration.ts` at
`astro:build:done`). Each redirect carries `rel="canonical"`, `noindex, follow`
and `data-pagefind-ignore`, and is written outside Astro's route list so it never
enters the sitemap, `discover.json`, the llms bundles or the search index. The
redirect set is derived from the live channel's own slugs, so no generated
history has to survive between builds, and an existing page is never overwritten.

## Consequences

- `src/.cache/docs/index.json` is schema **2**: `projects[].channels[]` with
  `{ id, ref, refKind, version, label, default, pages[] }`. Pages carry their
  `sourcePath` and a content `hash`. An old cache reads as absent, so the build
  forces a re-sync rather than linking pages the mirror no longer has.
- The mirror gains one directory level for non-default channels:
  `src/content/docs/docs/<id>/prerelease/<page>.md`. Every consumer that walked
  one level (generated-output check, discovery `lastmod`) now walks two.
- Each aggregated page's front matter names its channel (`docsChannel`,
  `docsRef`, `docsRefKind`, `docsVersion`). A tag-pinned page links to the file
  at that tag ("View source") rather than offering an edit that cannot work, and
  is not flagged stale: its content is the release, not drift.
- Channels are labelled with the **version they document**, not the ref they read.
  A tag channel names its own version, and a `prerelease` channel that follows
  `main` is labelled with the newest published prerelease
  (`Prerelease 3.0.0-prerelease.2`): a reader chooses between versions, and a
  branch name says nothing about which one the page describes. A `live` channel
  that fell back to a branch has no stable release to name and keeps the branch,
  as does a commit SHA. The resolved `ref` stays on the record, so the branch is
  still visible and the edit links still target it.
- The page switcher is a native `<details>` drop-down: the summary names the
  channel being read, the menu lists every version, the current one carries
  `aria-current`, and the ref is each option's tooltip. It needs no JavaScript,
  so the versions stay reachable, and every option is a real link.
- The sidebar shows one Starlight group per channel with the same labels
  (`Live 2.4.2`, `Prerelease 3.0.0-prerelease.2`); single-channel projects keep
  the flat list.
- The per-project `llms-full.txt` corpus publishes the live channel only, and
  the concise `llms.txt` links the prerelease channel when it exists. Two
  versions of one page in a single corpus is ambiguous to a model.
- `wiki` and `readme` sources support exactly one channel. A wiki is a
  standalone git repository with a single HEAD, and a README is one page; the
  schema rejects `channels` on them instead of accepting a declaration it cannot
  honour.
- Search indexes both channels. Prerelease pages carry a channel chip and a
  prose notice, so a result that came from the prerelease view says so.

## Alternatives considered

- **Version segments** (`/docs/<id>/2.4/`, `/docs/<id>/v3.0.0-prerelease.2/`).
  Every release would add a URL set, every promotion would need redirects, and
  the "latest" URL would still have to exist. Rejected in favour of a stable
  channel segment plus a version label on the page.
- **Auto-detecting a prerelease `main`** by comparing the branch version file to
  the release tags. The version file is not standardised across repositories,
  the comparison is unavailable offline, and a wrong guess publishes
  documentation for an API the reader does not have. Rejected in favour of an
  explicit declaration resolved from release data.
- **A client-side toggle** on one URL set. It would hide the distinction from
  search engines and from `llms.txt`, and make `/docs/<id>/<page>/` ambiguous.
- **Versioning the wiki source.** A repository wiki has no tags, so there is
  nothing to pin. Documented as unsupported rather than half-implemented.
- **Keeping both channels in `llms-full.txt`.** Rejected: one corpus should not
  contain two versions of the same page.
