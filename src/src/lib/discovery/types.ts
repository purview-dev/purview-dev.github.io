/**
 * The discovery model: the single description of everything the site wants
 * crawlers and AI tooling to find. `sitemap.ts`, `manifest.ts` and
 * `indexnow.ts` all consume the same `DiscoverableResource[]`, so the sitemap,
 * the public `discover.json` and the post-deploy IndexNow submission can never
 * disagree about what exists.
 *
 * Three layers of "standard" live here, and they are deliberately kept apart:
 *
 * - **Established**: sitemap XML, robots.txt, canonical URLs. Implemented as
 *   specified.
 * - **Emerging convention**: `llms.txt` / `llms-full.txt` (root and per project).
 *   Useful, but not a search-engine protocol.
 * - **Purview-specific**: `discover.json` and the internal deployment-state
 *   file. These are *our* machine-readable map, not anything the industry
 *   recognises — see `docs/discovery.md`.
 */

/** Bumped whenever the public `discover.json` shape changes incompatibly. */
export const DISCOVERY_MANIFEST_SCHEMA_VERSION = 1;

/** Bumped whenever the internal deployment-state shape changes. */
export const DEPLOYMENT_STATE_SCHEMA_VERSION = 1;

/**
 * What a resource is, which decides the sitemap it lands in and whether it is
 * advertised as an HTML page or a machine-readable representation.
 */
export type DiscoverableKind =
  | 'page' // hand-authored marketing/catalogue HTML (home, about, projects index, …)
  | 'project' // /projects/<id>/ HTML page generated from the catalogue
  | 'documentation' // /docs/<id>/… aggregated documentation pages
  | 'llms' // llms.txt (root or per project)
  | 'llms-full' // llms-full.txt (root or per project)
  | 'llms-small' // llms-small.txt (root only)
  | 'other'; // anything else Astro emits that we still want discoverable

/** One addressable thing on the site. */
export interface DiscoverableResource {
  /** Absolute canonical URL (site + base + path), e.g. `https://purview.dev/about/`. */
  url: string;
  kind: DiscoverableKind;
  /**
   * Content-derived modification date in W3C datetime form (ISO 8601). Never
   * the build time — see `last-modified.ts`. Omitted when no provenance exists.
   */
  lastModified?: string;
  /** False for pages robots/canonicals deliberately exclude from indexing. */
  indexable: boolean;
  /** Owning project id when the resource is project-scoped. */
  projectId?: string;
}

/** A project as exposed by the discovery manifest. */
export interface DiscoveryManifestProject {
  name: string;
  slug: string;
  url: string;
  description: string;
  repository: string;
  repositoryUrl: string;
  /** Canonical documentation entry point, or null when the project has none. */
  docs: string | null;
  category: string;
  status: string;
  experimental: boolean;
  /** Primary package information, when the project publishes one. */
  package: { id: string; url: string } | null;
  /** Highest known version across the project's packages, when known. */
  latestVersion: string | null;
  /** Per-project machine-readable resources, or null when the project has none. */
  llms: { summary: string; full: string } | null;
}

/**
 * The public `discover.json`: a stable, versioned map of the site. Purview-
 * specific — **not** an industry standard.
 */
export interface DiscoveryManifest {
  schemaVersion: typeof DISCOVERY_MANIFEST_SCHEMA_VERSION;
  name: string;
  url: string;
  /** Manifest generation time (not a per-URL modification date). */
  generatedAt: string;
  llms: { summary: string; small: string; full: string };
  sitemaps: { index: string; pages: string; projects: string; llms: string };
  counts: { resources: number; projects: number; documentation: number };
  /** Every discoverable resource, in canonical order. */
  resources: DiscoverableResource[];
  projects: DiscoveryManifestProject[];
}

/**
 * Internal deployment state (never published): a hash per URL so a future
 * change-detection scheme can compare content without re-downloading pages.
 */
export interface DeploymentState {
  schemaVersion: typeof DEPLOYMENT_STATE_SCHEMA_VERSION;
  generatedAt: string;
  resources: Record<string, { lastModified?: string; hash: string }>;
}

/** How a set of URLs changed between two deployments. */
export interface DiscoveryChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

/** The IndexNow batch body sent to `api.indexnow.org`. */
export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}
