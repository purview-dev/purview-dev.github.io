# 0014 — Rebuild when an upstream project changes, and only then

- **Status:** Accepted
- **Date:** 2026-11-14
- **Supersedes:** none

## Context

The site is built from the catalogue projects' repositories (documentation, skills, assets on the
default branch), their release tags and their package versions. It was rebuilt on a push here, weekly,
and on a `purview-site-rebuild` repository dispatch — which only a release workflow in a product
repository sends. A documentation change merged to a product repository's `main` therefore waited up to
a week, and a dispatch fired at release time often built before NuGet had indexed the new package.

A rebuild triggered directly by a push to another repository's `main` is not possible from here: GitHub
delivers no cross-repository push event, so each product repository would need a workflow (and a token)
of its own. The requirement is that the catalogue projects are not changed for this.

## Decision

1. **The deployed site records what it was built from.** After the build, `scripts/upstream-state.ts
   --write` publishes `/_discovery/upstream.json`: for each non-archived catalogue project, the head of
   its default branch and a digest of its tags (both from `git ls-remote`, which needs no token and has
   no API rate limit), and the latest version of each package from its registry.
2. **A nightly check compares, and rebuilds only on a change.** `upstream-refresh.yml` runs
   `--compare` against the deployed file and calls `deploy.yml` (now also a reusable workflow) only
   when something moved: a commit, a tag, a package version, or a project added to or removed from the
   catalogue. A value that could not be read on either side is not a change, so a registry outage does
   not rebuild every night. `workflow_dispatch` with `force` rebuilds regardless.
3. **The repository dispatch settles first.** `purview-site-rebuild` moved from `deploy.yml` to the
   same workflow: it waits 15 minutes for package publishing, then runs the same check. The waiting job
   is in a `cancel-in-progress` concurrency group, so a newer dispatch (or the nightly run) cancels a run
   that is still waiting and a burst of releases produces one build. A build already past the wait is
   never cancelled; `deploy.yml` keeps its own non-cancelling `pages` group.
4. **The weekly unconditional deploy stays**, for the figures the check deliberately ignores (download
   counts, stars).

## Consequences

- An upstream documentation change reaches the site the next night without any change upstream. A
  product repository that wants it sooner can send the dispatch from its own workflow, as before.
- The first nightly run after this lands rebuilds once (there is no recorded state yet); every deploy
  from then on records it.
- `/_discovery/upstream.json` is public. It holds only public data: commit ids, tag digests, versions.
