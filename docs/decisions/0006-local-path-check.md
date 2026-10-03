# ADR 0006 — The build-output safety scan checks machine paths, not drive letters

- Status: accepted
- Date: 2026-10-03

## Context

`just check-generated` and the built-output tests scan the published output for credentials and for
absolute paths that would identify the machine that produced the build. The original Windows rule was
`[A-Za-z]:\\[^\s"']+` — that is, any drive-letter path.

Aggregated documentation is not authored for this site; it is mirrored from the product repositories,
and some of them legitimately show Windows paths. The Containers guides document the Windows-only WSL
Containers (WSLC) backend and its image store as `D:\wslc-images` (and `@"D:\wslc-images"` in a C#
sample). Those samples are correct content, but the rule above flagged them as leaked build paths,
failing `just validate` for a reason that has nothing to do with the build machine.

## Decisions

### 1. The Windows rule matches machine-identifying paths only

A user profile (`C:\Users\<name>\…`), `AppData`, a GitHub Actions workspace (`D:\a\<repo>\…`), or a CI
runner directory (`actions-runner`, `hostedtoolcache`, `runneradmin`). A bare drive-letter path is no
longer treated as a leak.

### 2. Everything else is unchanged

The macOS/Linux home-directory rules, the `.cache`/`node_modules` rules, and the secret patterns are
untouched. The check was narrowed, not disabled.

### 3. One definition, two consumers

The patterns live in `src/src/lib/build-paths.ts` and are imported by both `src/scripts/check-generated.ts`
and the dist test suite, so the script and the tests cannot drift apart.

## Consequences

- Documentation that shows an absolute path on a non-system drive (or a drive example such as
  `D:\wslc-images`) builds without a false positive.
- A genuinely leaked path that is a bare drive root outside a known machine directory (for example
  `E:\scratch\out`) would no longer be caught. This is accepted: the scan exists to catch the build
  machine's own paths, and those always sit under a user profile, a runner workspace, `.cache`, or
  `node_modules`.
- The security-relevant half of the scan (secret patterns) is unchanged.
