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

const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'must be a lowercase slug using [a-z0-9-] only'),
  name: z.string().min(1, 'must be a non-empty display name'),
  shortDescription: z.string().min(1, 'must be a non-empty short description'),
  description: z.string().min(1, 'must be a non-empty long description'),
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

export const PROJECT_DEFAULTS = {
  featured: false,
  order: 1000,
  packages: [] as ProjectPackage[],
  related: [] as string[],
  discussions: false,
  install: 'nuget',
} satisfies {
  featured: boolean;
  order: number;
  packages: ProjectPackage[];
  related: string[];
  discussions: boolean;
  install: (typeof INSTALL_KINDS)[number];
};
