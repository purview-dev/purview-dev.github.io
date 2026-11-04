import * as React from 'react';

/**
 * ESM bridge for `react/compiler-runtime` (aliased in `astro.config.ts`).
 *
 * LikeC4's React bundle is compiled with the React Compiler and imports
 * `{ c }` from React's compiler runtime. That package is CommonJS, and its
 * development build assigns `exports.c` inside a conditional IIFE. Vite 8's
 * Rolldown optimiser does not see that as a named export, so the dev server
 * serves a default-only module and every LikeC4 island fails to hydrate with
 * "does not provide an export named 'c'".
 *
 * The runtime's whole implementation is `dispatcher.useMemoCache(size)`; this
 * bridge calls the same React internal the CJS runtime reads. It is pinned to
 * the React 19 client internals (React itself is pinned in package.json), and
 * it fails loudly rather than silently returning a cache outside a render.
 */
interface ReactClientInternals {
  H?: { useMemoCache?: (size: number) => unknown };
}

const INTERNALS_KEY = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE';

const internals = (React as unknown as Record<string, unknown>)[INTERNALS_KEY] as
  | ReactClientInternals
  | undefined;

export function c(size: number): unknown {
  const useMemoCache = internals?.H?.useMemoCache;
  if (!useMemoCache) {
    throw new Error(
      'react/compiler-runtime: useMemoCache is only available while a React component renders.',
    );
  }
  return useMemoCache(size);
}
