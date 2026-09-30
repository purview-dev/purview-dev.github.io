import type { ResolvedProject } from './manifest/load';

/**
 * The status a *reader* is shown.
 *
 * The manifest models two independent axes (ADR 0004): `status`, the
 * release/lifecycle channel, and `experimental`, the intent flag that says
 * "exploratory: the API and packaging may change and there is no support
 * promise". Presentation collapses them into one value, and this module is the
 * only place that resolution happens so the catalogue card, project page,
 * home-page version snapshot, documentation page, docs sidebar topic and the
 * catalogue filter can never disagree.
 */
export const DISPLAY_STATUSES = ['stable', 'preview', 'experimental', 'archived'] as const;

/** The single value every status badge and status filter renders. */
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/** Human-facing labels, used by `StatusBadge`. */
export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  stable: 'Stable',
  preview: 'Preview',
  experimental: 'Experimental',
  archived: 'Archived',
};

/**
 * Collapse the manifest's two axes into the displayed status.
 *
 * `archived` wins over everything — an archived project is never presented as
 * an experiment — and otherwise the `experimental` flag wins over the release
 * channel, because the warning is the whole point of the flag. The schema
 * already rejects `experimental` on an archived project; handling it here as
 * well keeps the precedence total and the function total.
 */
export function displayStatus(
  project: Pick<ResolvedProject, 'status' | 'experimental'>,
): DisplayStatus {
  if (project.status === 'archived') {
    return 'archived';
  }
  return project.experimental ? 'experimental' : project.status;
}
