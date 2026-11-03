import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

import { OWNER } from './lib/site';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        owners: z.array(z.string()).default([OWNER]),
        status: z.enum(['stable', 'preview', 'archived']),
        experimental: z.boolean().default(false),
        lastReviewed: z.string(),
        sourceProject: z.string(),
        sourceRepo: z.string(),
        projectName: z.string().optional(),
        sourcePath: z.string(),
        editUrl: z.string(),
        // Documentation channels (ADR 0009): which channel and git ref the page
        // was aggregated from, and whether that ref is editable (branch) or
        // read-only (tag).
        docsChannel: z.enum(['live', 'prerelease']).optional(),
        docsRef: z.string().optional(),
        docsRefKind: z.enum(['branch', 'tag', 'sha']).optional(),
        docsVersion: z.string().optional(),
        tags: z.array(z.string()).default([]),
      }),
    }),
  }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema(),
  }),
};
