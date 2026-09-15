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
        lastReviewed: z.string(),
        sourceProject: z.string(),
        sourceRepo: z.string(),
        sourcePath: z.string(),
        editUrl: z.string(),
      }),
    }),
  }),
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema(),
  }),
};
