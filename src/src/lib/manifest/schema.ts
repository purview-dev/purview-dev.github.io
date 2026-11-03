import { z } from 'zod';

export const CATEGORIES = [
  'application-framework',
  'validation',
  'observability',
  'source-generation',
  'aspire',
  'build-tooling',
  'developer-tooling',
] as const;

export const STATUSES = ['stable', 'preview', 'archived'] as const;

/** The lifecycle/release channel a project publishes on. */
export type ProjectStatus = (typeof STATUSES)[number];

/** How the primary NuGet package is consumed, which drives the Install options. */
export const INSTALL_KINDS = ['nuget', 'msbuild-sdk', 'dotnet-tool'] as const;

/**
 * Who a concrete use case speaks to. The vocabulary is deliberately small so
 * the same project can be framed for the person adopting a package, the person
 * approving its adoption, and the person extending it.
 */
export const AUDIENCES = ['developer', 'team-lead', 'architect', 'contributor'] as const;

/** Human-facing labels for the audience tags (used in the UI). */
export const AUDIENCE_LABELS: Record<(typeof AUDIENCES)[number], string> = {
  developer: 'Developer',
  'team-lead': 'Team lead',
  architect: 'Architect',
  contributor: 'Contributor',
};

/**
 * A concrete, ideally runnable example of the project solving a real problem.
 * Screenshots of prose are not evidence: `code`/`evidence` carry the proof and
 * `outcome` states what the reader gets. `docsPage` optionally deep-links into
 * the project's aggregated documentation at `/docs/<project>/<docsPage>/`.
 */
const useCaseSchema = z
  .object({
    audience: z.enum(AUDIENCES),
    title: z.string().min(1, 'must be a short, concrete scenario title'),
    scenario: z.string().min(1, 'must describe the situation the reader is in'),
    outcome: z.string().min(1, 'must describe what the reader gets from the project'),
    code: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    evidence: z.string().min(1).optional(),
    docsPage: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'must be a lowercase docs page slug using [a-z0-9-] only')
      .optional(),
  })
  .refine((value) => value.code === undefined || value.language !== undefined, {
    message: 'is required when "code" is provided',
    path: ['language'],
  });

/**
 * Documentation channels (`live` and, optionally, `prerelease`).
 *
 * A channel is a second view of the same documentation taken from a different
 * git ref: the release a reader can install today (`live`, the default) and the
 * line that has not shipped yet (`prerelease`). `ref` selects the source; every
 * other field overrides the shared `docs` layout, because a release tag's tree
 * can legitimately differ from the default branch (a renamed page, a different
 * landing page).
 *
 * `ref` accepts three tokens — `default` (the repository's default branch),
 * `latest-stable` and `latest-prerelease` (the newest matching GitHub release
 * tag) — or any branch/tag name used verbatim. See `lib/docs/channels`.
 */
const docsChannelSchema = z.object({
  ref: z
    .string()
    .min(
      1,
      'must be a ref token (`default`, `latest-stable`, `latest-prerelease`) or a branch/tag name',
    )
    .optional(),
  path: z.string().min(1, 'must be a non-empty repository path such as "docs"').optional(),
  rootPage: z.string().min(1, 'must be a non-empty markdown file path').optional(),
  readmeAsIndex: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const docsChannelsSchema = z
  .object({
    live: docsChannelSchema.optional(),
    prerelease: docsChannelSchema.optional(),
  })
  .refine((value) => value.live !== undefined || value.prerelease !== undefined, {
    message: 'must declare `live`, `prerelease`, or both',
  });

const docsPathSchema = z.object({
  source: z.literal('github-path'),
  path: z.string().min(1, 'must be a non-empty repository path such as "docs"'),
  rootPage: z.string().min(1, 'must be a non-empty markdown file path').optional(),
  readmeAsIndex: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  channels: docsChannelsSchema.optional(),
  /**
   * Slugs that moved, as `previous: current`.
   *
   * Reorganising a documentation tree changes published URLs, and a reader's
   * bookmark should not 404 because of it. The site writes a meta-refresh
   * redirect for every pair; a redirect never shadows a real page, so an entry
   * stays inert while the old slug is still published — for example on a `live`
   * channel pinned to an older tag, which activates it at promotion.
   */
  redirects: z.record(z.string().min(1), z.string().min(1)).optional(),
});

/**
 * A wiki is its own git repository with a single HEAD, so it has no ref to pin
 * a second channel to. `.strict()` is what turns a mistaken
 * `channels:`/`path:` on a wiki block into an error instead of silently
 * dropping it.
 */
const docsWikiSchema = z
  .object({
    source: z.literal('wiki'),
    rootPage: z.string().min(1, 'must be a non-empty markdown file path').optional(),
    readmeAsIndex: z.boolean().optional(),
    order: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();

const docsReadmeSchema = z
  .object({
    source: z.literal('readme'),
  })
  .strict();

const docsSchema = z.discriminatedUnion('source', [
  docsPathSchema,
  docsWikiSchema,
  docsReadmeSchema,
]);

/**
 * An Agent Skill the project publishes from its repository root.
 *
 * The ecosystem convention (see the engineering playbook's *Agent Skills
 * Distribution*) is one directory per skill at `skills/<name>/SKILL.md`, and the
 * skills CLI is the only delivery route: nothing ships a skill inside a NuGet
 * package or writes into an agent directory during a build. The catalogue
 * records the skills so the site can mirror them to stable `purview.dev` URLs
 * and show the same install instructions everywhere (ADR 0010).
 */
const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'must be a lowercase slug using [a-z0-9-] only'),
  /** Repository directory holding the skill; defaults to `skills/<name>`. */
  path: z.string().min(1, 'must be a non-empty repository path').optional(),
  description: z.string().min(1, 'must be a short description').optional(),
});

const packageSchema = z.object({
  id: z.string().min(1, 'must be a non-empty NuGet package id'),
  description: z.string().optional(),
  primary: z.boolean().optional(),
  targetFrameworks: z.array(z.string()).optional(),
});

/**
 * A repository file mirrored verbatim into the built site, so a stable
 * purview.dev URL can serve an artefact that lives in a product repository
 * (for example a JSON Schema). `path` is relative to the repository root;
 * `output` is relative to the site root (`public/`).
 */
const assetSchema = z.object({
  path: z.string().min(1, 'must be a non-empty repository path'),
  output: z
    .string()
    .min(1, 'must be a non-empty output path')
    .regex(/^[^/\\]/, 'must be a relative path without a leading slash')
    .refine((value) => !value.split(/[\\/]/).includes('..'), 'must not contain a ".." segment'),
  description: z.string().min(1).optional(),
});

/**
 * Upstream work a project credits: the original library it was based on and/or
 * the project it was forked from. Optional — only derived projects declare it.
 */
const acknowledgmentSchema = z.object({
  name: z.string().min(1, 'must be a non-empty name'),
  url: z.url('must be a valid URL'),
  description: z.string().optional(),
});

const projectSchema = z
  .object({
    /** Editor hint; stripped by the loader and never part of a resolved record. */
    $schema: z.string().optional(),
    id: z.string().regex(/^[a-z0-9-]+$/, 'must be a lowercase slug using [a-z0-9-] only'),
    name: z.string().min(1, 'must be a non-empty display name'),
    shortDescription: z.string().min(1, 'must be a non-empty short description'),
    description: z.string().min(1, 'must be a non-empty long description'),
    origin: z.string().min(1, 'must explain why the project became reusable tooling'),
    useWhen: z.string().min(1, 'must explain when the project is a good fit'),
    avoidWhen: z.string().min(1, 'must explain when the project is not a good fit'),
    repository: z
      .string()
      .regex(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/, 'must be in "owner/repository" form'),
    category: z.enum(CATEGORIES),
    status: z.enum(STATUSES),
    /**
     * Marks an exploratory project: the API, defaults and packaging may change
     * between prereleases and there is no production support guarantee. This is
     * deliberately orthogonal to `status`, which stays the project's release
     * channel (ADR 0004). Only valid on `projects[]`.
     */
    experimental: z.boolean().optional(),
    featured: z.boolean().optional(),
    order: z.number().int().nonnegative().optional(),
    docs: docsSchema.optional(),
    install: z.enum(INSTALL_KINDS).optional(),
    targetFrameworks: z.array(z.string()).optional(),
    packages: z.array(packageSchema).optional(),
    skills: z.union([z.boolean(), z.array(skillSchema)]).optional(),
    assets: z.array(assetSchema).optional(),
    related: z.array(z.string()).optional(),
    useCases: z.array(useCaseSchema).optional(),
    acknowledgments: z.array(acknowledgmentSchema).optional(),
    supersedes: z.string().optional(),
    supersededBy: z.string().optional(),
    /**
     * Whether the project links its GitHub Discussions. Detected from the
     * repository (`hasDiscussions` in the release cache); set it only to
     * override the detection — `false` opts a repository out.
     */
    discussions: z.boolean().optional(),
  })
  .refine((value) => !(value.experimental === true && value.status === 'archived'), {
    message: 'cannot be true when `status` is archived: an archived project is not an experiment',
    path: ['experimental'],
  })
  .refine(
    (value) =>
      !Array.isArray(value.skills) ||
      new Set(value.skills.map((skill) => skill.name)).size === value.skills.length,
    { message: 'must not repeat a skill name', path: ['skills'] },
  );

const externalProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'must be a lowercase slug using [a-z0-9-] only'),
  name: z.string().min(1, 'must be a non-empty display name'),
  shortDescription: z.string().min(1, 'must be a non-empty short description'),
  description: z.string().min(1, 'must be a non-empty long description'),
  url: z.url('must be a valid external URL'),
  repository: z
    .string()
    .regex(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/, 'must be in "owner/repository" form')
    .optional(),
  category: z.enum(CATEGORIES),
  status: z.enum(STATUSES).optional(),
  featured: z.boolean().optional(),
  order: z.number().int().nonnegative().optional(),
});

export const manifestSchema = z.object({
  $schema: z.string().optional(),
  // Defaulted so the collaborations file, which legitimately declares no
  // `projects`, is valid on its own (ADR 0005).
  projects: z.array(projectSchema).default([]),
  externalProjects: z.array(externalProjectSchema).default([]),
});

export type ProjectManifest = z.infer<typeof manifestSchema>;
export type ProjectRecord = z.infer<typeof projectSchema>;
export type ExternalProjectRecord = z.infer<typeof externalProjectSchema>;
export type ProjectDocsConfig = z.infer<typeof docsSchema>;
export type ProjectDocsChannel = z.infer<typeof docsChannelSchema>;
export type ProjectSkill = z.infer<typeof skillSchema>;
export type ProjectPackage = z.infer<typeof packageSchema>;
export type ProjectAsset = z.infer<typeof assetSchema>;
export type ProjectAcknowledgment = z.infer<typeof acknowledgmentSchema>;
export type ProjectUseCase = z.infer<typeof useCaseSchema>;

export const PROJECT_DEFAULTS = {
  experimental: false,
  featured: false,
  order: 1000,
  packages: [] as ProjectPackage[],
  skills: [] as ProjectSkill[],
  assets: [] as ProjectAsset[],
  related: [] as string[],
  useCases: [] as ProjectUseCase[],
  acknowledgments: [] as ProjectAcknowledgment[],
  discussions: false,
  install: 'nuget',
} satisfies {
  experimental: boolean;
  featured: boolean;
  order: number;
  packages: ProjectPackage[];
  skills: ProjectSkill[];
  assets: ProjectAsset[];
  related: string[];
  useCases: ProjectUseCase[];
  acknowledgments: ProjectAcknowledgment[];
  discussions: boolean;
  install: (typeof INSTALL_KINDS)[number];
};
