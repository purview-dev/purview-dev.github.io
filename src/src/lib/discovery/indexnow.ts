import type {
  DeploymentState,
  DiscoverableResource,
  DiscoveryChangeSet,
  IndexNowPayload,
} from './types';

/**
 * IndexNow payload construction and change detection. Pure functions only —
 * the network call lives in `indexnow-client.ts` — so the batching, diffing and
 * redaction rules can be tested without touching the internet.
 */

/** Protocol-wide endpoint; not coupled to any single search engine. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The protocol's per-request URL limit; larger change sets are batched. */
export const INDEXNOW_MAX_URLS = 10_000;

/**
 * Compare the previous deployment's resources with the current ones. A URL that
 * is new is *added*; a URL whose `lastModified` moved is *modified*; a URL that
 * disappeared is *deleted*. This is why meaningful `lastmod` values matter: they
 * are also the notification signal.
 */
export function diffResources(
  previous: readonly DiscoverableResource[] | null,
  current: readonly DiscoverableResource[],
): DiscoveryChangeSet {
  const before = new Map((previous ?? []).map((resource) => [resource.url, resource]));
  const after = new Map(current.map((resource) => [resource.url, resource]));

  const added: string[] = [];
  const modified: string[] = [];
  for (const [url, resource] of after) {
    const old = before.get(url);
    if (!old) {
      added.push(url);
    } else if (old.lastModified !== resource.lastModified) {
      modified.push(url);
    }
  }
  const deleted = [...before.keys()].filter((url) => !after.has(url));

  return { added: added.toSorted(), modified: modified.toSorted(), deleted: deleted.toSorted() };
}

/** Compare two internal deployment-state bodies by content hash. */
export function diffDeploymentStates(
  previous: DeploymentState | null,
  current: DeploymentState,
): DiscoveryChangeSet {
  const before = previous?.resources ?? {};
  const after = current.resources;
  const added: string[] = [];
  const modified: string[] = [];
  for (const [url, entry] of Object.entries(after)) {
    const old = before[url];
    if (!old) {
      added.push(url);
    } else if (old.hash !== entry.hash) {
      modified.push(url);
    }
  }
  const deleted = Object.keys(before).filter((url) => !(url in after));
  return { added: added.toSorted(), modified: modified.toSorted(), deleted: deleted.toSorted() };
}

/**
 * URLs worth notifying engines about: newly created and materially modified
 * pages. Deletions are not submitted — IndexNow has no delete semantics — but
 * they are reported so the operator can see them.
 */
export function urlsToSubmit(changeSet: DiscoveryChangeSet): string[] {
  return [...changeSet.added, ...changeSet.modified].toSorted();
}

/** Total number of changes, for the dry-run summary. */
export function changeCount(changeSet: DiscoveryChangeSet): number {
  return changeSet.added.length + changeSet.modified.length + changeSet.deleted.length;
}

/** Split a list into protocol-sized batches. */
export function chunk<T>(items: readonly T[], size: number = INDEXNOW_MAX_URLS): T[][] {
  if (size < 1) {
    throw new Error('chunk size must be at least 1');
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/** The public location of the IndexNow key verification file. */
export function indexNowKeyLocation(origin: string, key: string): string {
  return `${origin.replace(/\/+$/, '')}/${key}.txt`;
}

/**
 * Guard against submitting arbitrary URLs: every URL must belong to the
 * configured canonical origin before anything is sent over the network.
 */
export function assertCanonicalOrigin(urls: readonly string[], origin: string): void {
  const normalized = origin.replace(/\/+$/, '');
  const offenders = urls.filter((url) => !(url === normalized || url.startsWith(`${normalized}/`)));
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to submit URLs outside ${normalized} (${offenders.length} offending, e.g. ${offenders[0]})`,
    );
  }
}

/** Build the request body for one batch. */
export function buildIndexNowPayload(
  host: string,
  key: string,
  keyLocation: string,
  urls: readonly string[],
): IndexNowPayload {
  return { host, key, keyLocation, urlList: [...urls] };
}

/** Replace a secret in arbitrary text (log lines, error bodies) before printing. */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[redacted]');
}
