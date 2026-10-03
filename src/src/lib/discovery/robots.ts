import { sitemapIndexUrl } from './urls';

/**
 * The generated `/robots.txt`.
 *
 * Policy, stated once and generated so it can never drift from the sitemap URL:
 *
 * - **Search indexing crawlers** (Googlebot, Bingbot, …) are welcome via the
 *   `User-agent: *` section.
 * - **AI search crawlers** (`OAI-SearchBot`, which powers ChatGPT Search) are
 *   permitted explicitly, because a general `Allow: /` is not always read as an
 *   affirmative AI-crawler policy.
 * - **Qwant** (`QwantBot`) is permitted explicitly for the same reason.
 * - **Model-training crawlers** are neither permitted nor blocked beyond the
 *   general `Allow: /`: the site defines no training-specific policy, and
 *   inventing speculative `User-agent` names is deliberately avoided.
 *
 * The `Sitemap` directive points at the sitemap index, which is what every
 * crawler above discovers the rest of the site through.
 */
export function renderRobotsTxt(): string {
  return [
    '# Purview-Dev crawler policy.',
    '# Search indexing and AI search crawlers are welcome. No model-training',
    '# restrictions are defined; unknown crawlers fall under the "*" section.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# AI search (ChatGPT Search). Permitted explicitly.',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    '',
    '# Qwant search crawler. Permitted explicitly.',
    'User-agent: QwantBot',
    'Allow: /',
    '',
    `Sitemap: ${sitemapIndexUrl()}`,
    '',
  ].join('\n');
}
