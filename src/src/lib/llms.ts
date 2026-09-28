/**
 * Link attributes for the generated LLM text bundles — `llms.txt`,
 * `llms-small.txt`, `llms-full.txt`, and the per-project
 * `/_llms-txt/<project-id>.txt` sets.
 *
 * These are plain-text files rather than site pages, so every link to one is
 * treated like an external link and opens in a new tab. Spreading the object
 * keeps the call sites short enough to stay on one line.
 */
export const LLMS_LINK_ATTRS = {
  rel: 'noopener noreferrer',
  target: '_blank',
} as const;
