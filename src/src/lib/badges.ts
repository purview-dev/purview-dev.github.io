import { OWNER } from './site';

const BADGE_STYLE = 'flat-square';

/**
 * Shields.io badge URLs for project metadata. Rendered as `<img>` links that
 * pull live status/version data from NuGet and GitHub Actions at view time.
 */

/** NuGet package version badge. */
export function nugetVersionBadge(packageId: string): string {
  return `https://img.shields.io/nuget/v/${encodeURIComponent(packageId)}?style=${BADGE_STYLE}&label=nuget`;
}

/** NuGet package download-count badge. */
export function nugetDownloadsBadge(packageId: string): string {
  return `https://img.shields.io/nuget/dt/${encodeURIComponent(packageId)}?style=${BADGE_STYLE}&label=downloads`;
}

/**
 * Build/CI badge for a repository's shared release pipeline. The org runs the
 * `release.yml` workflow on every push to `main`, so it doubles as the build
 * status for the default branch.
 */
export function buildBadge(repository: string): string {
  const [owner = OWNER, repo = ''] = repository.split('/');
  return `https://img.shields.io/github/actions/workflow/status/${owner}/${repo}/release.yml?style=${BADGE_STYLE}&label=build`;
}

/** GitHub Actions page URL for a repository (badge click target). */
export function actionsUrl(repository: string): string {
  return `https://github.com/${repository}/actions`;
}
