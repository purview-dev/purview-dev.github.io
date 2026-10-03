/**
 * Patterns for the post-build safety scan: credentials that must never reach the
 * published output, and build-machine paths that must not leak into it.
 *
 * `src/scripts/check-generated.ts` and the built-output test suite both import
 * these, so the script and the tests cannot drift apart. See ADR 0006 for why
 * the Windows rule is narrower than "any `X:\…`".
 */

/** Credentials that must never appear in the built output. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bghp_[A-Za-z0-9]{36,}\b/,
  /\bgho_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bNUGET__APIKEY\s*[:=]\s*\S+/i,
];

/**
 * Absolute paths that identify the machine that produced the build.
 *
 * A bare `X:\…` is deliberately **not** listed: documentation legitimately
 * shows drive-letter examples (the Windows/WSL Containers guides use
 * `D:\wslc-images`), so flagging them is a false positive rather than a leak
 * (ADR 0006). The Windows rule therefore only matches a user profile,
 * `AppData`, or a CI runner workspace.
 */
export const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:\\Users\\[^\\\s"']+/i, // C:\Users\<name>\…
  /[A-Za-z]:\\[^\s"']*\\AppData\\/i, // …\AppData\…
  /[A-Za-z]:\\a\\[^\\\s"']+\\/i, // D:\a\<repo>\<repo>\… (GitHub Actions)
  /[A-Za-z]:\\(?:actions-runner|hostedtoolcache|runneradmin)\\/i, // CI runner dirs
  /\/Users\/[^\s"']+/, // macOS home paths (case-sensitive)
  /\/home\/[A-Za-z0-9._-]+\//, // Linux home paths
  /\.cache[/\\]/,
  /node_modules[/\\]/,
];

/** The first pattern that matches `content`, or null when none does. */
export function firstMatchingPattern(patterns: readonly RegExp[], content: string): RegExp | null {
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return pattern;
    }
  }
  return null;
}
