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

const docsPathSchema = z.object({
  source: z.literal('github-path'),
  path: z.string().min(1, 'must be a non-empty repository path such as "docs"'),
  rootPage: z.string().min(1, 'must be a non-empty markdown file path').optional(),
  readmeAsIndex: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const docsWikiSchema = z.object({
  source: z.literal('wiki'),
  rootPage: z.string().min(1, 'must be a non-empty markdown file path').optional(),
  readmeAsIndex: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const docsReadmeSchema = z.object({
  source: z.literal('readme'),
});

const docsSchema = z.discriminatedUnion('source', [
  docsPathSchema,
  docsWikiSchema,
  docsReadmeSchema,
]);

const packageSchema = z.object({
  id: z.string().min(1, 'must be a non-empty NuGet package id'),
  description: z.string().optional(),
  primary: z.boolean().optional(),
  targetFrameworks: z.array(z.string()).optional(),
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

const projectSchema = z.object({
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
  featured: z.boolean().optional(),
  order: z.number().int().nonnegative().optional(),
  docs: docsSchema.optional(),
  install: z.enum(INSTALL_KINDS).optional(),
  targetFrameworks: z.array(z.string()).optional(),
  packages: z.array(packageSchema).optional(),
  related: z.array(z.string()).optional(),
  useCases: z.array(useCaseSchema).optional(),
  acknowledgments: z.array(acknowledgmentSchema).optional(),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
  discussions: z.boolean().optional(),
});

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
  projects: z.array(projectSchema),
  externalProjects: z.array(externalProjectSchema).default([]),
});

export type ProjectManifest = z.infer<typeof manifestSchema>;
export type ProjectRecord = z.infer<typeof projectSchema>;
export type ExternalProjectRecord = z.infer<typeof externalProjectSchema>;
export type ProjectDocsConfig = z.infer<typeof docsSchema>;
export type ProjectPackage = z.infer<typeof packageSchema>;
export type ProjectAcknowledgment = z.infer<typeof acknowledgmentSchema>;
export type ProjectUseCase = z.infer<typeof useCaseSchema>;

export const PROJECT_DEFAULTS = {
  featured: false,
  order: 1000,
  packages: [] as ProjectPackage[],
  related: [] as string[],
  useCases: [] as ProjectUseCase[],
  acknowledgments: [] as ProjectAcknowledgment[],
  discussions: false,
  install: 'nuget',
} satisfies {
  featured: boolean;
  order: number;
  packages: ProjectPackage[];
  related: string[];
  useCases: ProjectUseCase[];
  acknowledgments: ProjectAcknowledgment[];
  discussions: boolean;
  install: (typeof INSTALL_KINDS)[number];
};
