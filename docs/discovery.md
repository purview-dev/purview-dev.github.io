# Search & AI discovery

This document explains how `purview.dev` is made discoverable — by search
engines, AI search crawlers, and tooling that reads machine-readable content —
and the one-time steps that remain manual.

Everything below is generated at build time from the site's existing sources of
truth (the project catalogue, the aggregated documentation manifest and the
release cache). **There is no hand-maintained list of URLs.**

## Three layers, deliberately kept apart

| Layer | Examples | Status |
| --- | --- | --- |
| Established standards | sitemap XML, `robots.txt`, canonical URLs, Schema.org JSON-LD, IndexNow | Implemented as specified |
| Emerging convention | `llms.txt` / `llms-full.txt` (root and per project) | Useful, but not a search-engine protocol |
| Purview-specific | `discover.json`, the internal deployment state | Our own tooling, not an industry standard |

## What is generated, and where

| Artifact | Path | Produced by |
| --- | --- | --- |
| Sitemap index | `/sitemap-index.xml` | `purview-discovery` Astro integration |
| Child sitemaps | `/sitemaps/pages.xml`, `/sitemaps/projects.xml`, `/sitemaps/llms.xml` | integration |
| Crawler policy | `/robots.txt` | integration (`lib/discovery/robots.ts`) |
| Site map (JSON) | `/discover.json` | integration (`lib/discovery/manifest.ts`) |
| Root LLM content | `/llms.txt`, `/llms-small.txt`, `/llms-full.txt` | `starlight-llms-txt` |
| Per-project LLM content | `/projects/<slug>/llms.txt`, `/projects/<slug>/llms-full.txt` | integration (`lib/discovery/project-llms.ts`) |
| IndexNow key file | `/<INDEXNOW_KEY>.txt` (written from the secret) | deploy workflow via `bun run discovery:key` |
| Internal deployment state | `src/.cache/discovery/state.json` (never published) | integration |

The integration lives in `src/config/discovery-integration.ts`; the shared model
is in `src/src/lib/discovery/`.

### Sitemap partitioning

- **pages.xml** — hand-authored pages (`/`, `/about/`, `/docs/`, `/projects/`,
  `/releases/`, `/use-cases/`).
- **projects.xml** — every project landing page (`/projects/<id>/`) and all of
  its aggregated documentation (`/docs/<id>/…`), derived from the catalogue and
  the docs manifest.
- **llms.xml** — the machine-readable resources (root and per project).

Error pages (`404`, `500`), non-canonical aliases and non-indexable pages are
excluded.

### Meaningful `lastmod`

`lastmod` is **never** the build time. Each resource is dated from the source
that produced it (`src/src/lib/discovery/last-modified.ts`):

1. the last commit that touched the source file — one bulk `git log` per build,
   indexed in memory (a change to one project does not touch other pages);
2. the project's latest release date, for project pages;
3. the documentation page's own `lastReviewed` date, for docs pages;
4. the release-cache `retrievedAt` as a coarse fallback when `.git` is absent.

The deploy workflow checks out full history (`fetch-depth: 0`) so (1) is
accurate in CI.

## Commands

```shell
bun run discovery:validate                     # validate the built artifacts in dist/
bun run discovery:manifest                     # regenerate artifacts in dist/ from current caches
bun run discovery:key                          # write /<INDEXNOW_KEY>.txt from the secret
bun run discovery:indexnow --dry-run           # show what would be submitted (no network, no key)
bun run discovery:indexnow --dry-run --verbose # include the URL lists
```

`just` equivalents: `just discovery-validate`, `just discovery-manifest`,
`just discovery-key`, `just discovery-indexnow --dry-run`.

`discovery:validate` runs as part of `just validate` and `bun run ci:build`, and
fails the build on: missing/malformed sitemaps, non-absolute or off-origin URLs,
duplicate canonicals, a `robots.txt` that does not advertise the sitemap, a
`discover.json` that references unknown projects, missing per-project LLM
resources, development URLs in production output, and a missing IndexNow key file
when the key is configured.

## IndexNow

IndexNow is the active post-deployment notification mechanism for Bing and other
participating engines. It notifies the protocol-wide endpoint
`https://api.indexnow.org/indexnow` — never a single engine.

- **Key.** The key is a public verification value (8–128 chars of `[A-Za-z0-9-]`).
  It is **supplied only by the GitHub repository secret `INDEXNOW_KEY`** and is
  never part of the build. After the build, the deploy workflow runs
  `bun run discovery:key`, which writes the required verification file to
  `https://purview.dev/<key>.txt` from the secret. The build environment and
  build logs never see the key.
- **Changed URLs only.** `discovery:indexnow` compares the previous deployment's
  `discover.json` with the new one and submits only **added** and **modified**
  URLs. Deletions are reported but not submitted (IndexNow has no delete
  semantics). The very first deployment submits everything, which is correct.
- **Dry run.** `--dry-run` performs no network call and needs no key.
- **Safety.** Every URL is checked against the configured canonical origin before
  submission, and the key is never logged.

### How change detection works on GitHub Pages

The build job captures the currently deployed `discover.json` *before* building
and re-publishes it as `/_discovery/previous.json` inside the new deployment.
After a successful deploy, the `indexnow` job fetches that previous manifest and
the new `/discover.json`, diffs them, and submits the changes. No cross-job
artifact or persistent cache is required.

### Failure semantics

The `indexnow` job runs only after the `deploy` job succeeds (`needs: deploy`),
so a failed deployment never announces new URLs. A notification failure is
reported by the `indexnow` job but does **not** roll back or invalidate the
successful deployment: the site is live and correct either way. Retryable
responses (HTTP 429/5xx) are retried with backoff before a batch is reported as
failed.

## One-time manual configuration

These steps are performed once by an operator; routine updates are automatic.

### Google

1. Register `https://purview.dev/` as a **Domain property** in Google Search
   Console, preferably using **DNS verification** (the domain is controlled
   separately from the site).
2. Submit `https://purview.dev/sitemap-index.xml`.

No Google Indexing API is used: it is not the mechanism for ordinary
documentation pages. Google updates through crawlable links, canonical URLs, the
sitemap and meaningful `lastmod`.

### Bing

1. Register/import `purview.dev` in **Bing Webmaster Tools**.
2. Verify the sitemap: `https://purview.dev/sitemap-index.xml`.
3. Set the `INDEXNOW_KEY` repository secret (see above). All routine updates are
   then automated via IndexNow.

### Qwant

No routine submission is required. `QwantBot` is explicitly permitted in
`robots.txt` and discovers content through the sitemap and crawlable links.

### Startpage

No Purview-specific implementation. Startpage depends on upstream search
indexes, so its visibility follows the Google/Bing strategy.

### OpenAI / ChatGPT

`OAI-SearchBot` is explicitly permitted in `robots.txt`. HTML documentation and
the LLM resources are reachable through ordinary links. There is no supported
"LLM submission API", so none is invented; `llms.txt` is an additional
representation, not a guarantee of indexing.

## Local development

IndexNow never runs during normal local development: it requires an explicit
production command, and `--dry-run` needs no key and makes no network call.

```shell
bun run build
bun run discovery:validate
bun run discovery:indexnow --dry-run
```

## Operational checklist

Automated (nothing to do per deploy):

- [x] Sitemap index + child sitemaps generated
- [x] `robots.txt` generated and references the sitemap
- [x] Root `llms.txt` / `llms-full.txt` generated
- [x] Per-project `llms.txt` / `llms-full.txt` generated
- [x] `discover.json` generated
- [x] IndexNow key file written from the secret by the deploy workflow
- [x] IndexNow notifies changed URLs after a successful deploy
- [x] `discovery:validate` enforced in CI

One-time (operator):

- [ ] Deploy the discovery implementation
- [ ] Verify `https://purview.dev/robots.txt`
- [ ] Verify `https://purview.dev/sitemap-index.xml`
- [ ] Verify `https://purview.dev/llms.txt`
- [ ] Verify `https://purview.dev/llms-full.txt`
- [ ] Verify `https://purview.dev/discover.json`
- [ ] Verify the IndexNow key endpoint `https://purview.dev/<key>.txt`
- [ ] Register the Google Search Console Domain property (DNS verification)
- [ ] Submit the sitemap to Google
- [ ] Register/import the domain in Bing Webmaster Tools
- [ ] Submit the sitemap to Bing
- [ ] Set the `INDEXNOW_KEY` repository secret
- [ ] Verify the first IndexNow deployment
- [ ] Verify a representative project LLM resource
      (`https://purview.dev/projects/zodsharp/llms.txt`)

## Security

- The IndexNow key is supplied only through the `INDEXNOW_KEY` secret and is
  written into the built site by the deploy workflow (`bun run discovery:key`),
  never by the build itself; it is never committed and never logged.
- `discovery:indexnow` refuses to submit any URL outside the configured canonical
  origin.
- The build's secret/local-path scan (`check-generated`) also covers the
  discovery artifacts.