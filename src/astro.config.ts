import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightSidebarTopics from 'starlight-sidebar-topics';

import { readDocsManifest } from './src/lib/docs/aggregate';
import { buildProjectItems } from './src/lib/docs/sidebar';
import { loadProjects } from './src/lib/manifest/load';
import { SITE, BRAND } from './src/lib/site';
import { absoluteUrl } from './src/lib/urls';

const projects = loadProjects();
const docsManifest = readDocsManifest();

const docsProjects = projects.filter((project) => project.docs && project.status !== 'archived');
const previewBadge = { text: 'Preview', variant: 'caution' } as const;
const sidebarTopics = [
  { label: 'Documentation home', link: '/docs/' },
  ...docsProjects.map((project) => ({
    label: project.name,
    link: `/docs/${project.id}/`,
    badge: project.status === 'preview' ? previewBadge : undefined,
    items: buildProjectItems(project, docsManifest),
  })),
];

const HEAD = [
  {
    tag: 'link' as const,
    attrs: { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  },
  {
    tag: 'link' as const,
    attrs: { rel: 'icon', href: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
  },
  {
    tag: 'link' as const,
    attrs: { rel: 'icon', href: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
  },
  {
    tag: 'link' as const,
    attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  },
  {
    tag: 'link' as const,
    attrs: { rel: 'manifest', href: '/site.webmanifest' },
  },
  {
    tag: 'meta' as const,
    attrs: { name: 'theme-color', content: BRAND.purple, media: '(prefers-color-scheme: light)' },
  },
  {
    tag: 'meta' as const,
    attrs: { name: 'theme-color', content: BRAND.inkLight, media: '(prefers-color-scheme: dark)' },
  },
  {
    tag: 'meta' as const,
    attrs: { property: 'og:type', content: 'website' },
  },
  {
    tag: 'meta' as const,
    attrs: { property: 'og:site_name', content: SITE.fullName },
  },
  {
    tag: 'meta' as const,
    attrs: { property: 'og:image', content: absoluteUrl('/og/default.png') },
  },
  {
    tag: 'meta' as const,
    attrs: { name: 'twitter:card', content: 'summary_large_image' },
  },
];

export default defineConfig({
  site: SITE.url,
  base: process.env.PAGES_BASE ?? '/',
  trailingSlash: 'always',
  output: 'static',
  build: {
    format: 'directory',
  },
  compressHTML: true,
  integrations: [
    preact(),
    sitemap(),
    starlight({
      title: SITE.fullName,
      description: SITE.description,
      // The favicon links (including the adaptive SVG) are provided by `head`
      // below; declaring `favicon` here as well would emit them twice.
      // Note: the site header is rendered by a Header override (SiteBrand) so
      // no `logo` config is needed here.
      // Documentation is served at project-root paths (e.g. /telemetry-sourcegenerator/).
      // This keeps content in the default locale, which is required for
      // llms.txt generation and avoids a misleading language selector.
      editLink: {
        // Fallback only: documentation pages render their edit link from the
        // `editUrl` front matter via an EditLink override, since documentation
        // originates from many repositories.
        baseUrl: 'https://github.com/purview-dev/purview-dev.github.io/edit/main/',
      },
      disable404Route: true,
      // Per-project documentation lives under project-root paths; the
      // sidebar-topics plugin presents each project as its own dropdown topic,
      // so no `sidebar` config is set here.
      customCss: ['./src/styles/global.css'],
      expressiveCode: {
        themes: ['starlight-light', 'starlight-dark'],
      },
      components: {
        Header: './src/components/starlight/Header.astro',
        PageFrame: './src/components/starlight/PageFrame.astro',
        EditLink: './src/components/starlight/EditLink.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
      },
      plugins: [
        starlightSidebarTopics(sidebarTopics),
        starlightLinksValidator({
          // Relative links between aggregated doc pages (e.g. `../foo/`) are
          // resolved by the browser against the final URL and validated by the
          // post-build `check-links` crawl. The plugin cannot resolve these
          // directory-style relative links, so its relative-link check is
          // disabled here in favour of the accurate dist crawl.
          errorOnRelativeLinks: false,
        }),
        starlightLlmsTxt({
          projectName: 'Purview Dev',
          description: SITE.description,
          details: [
            'Purview Dev builds developer tooling for .NET: event sourcing, telemetry, validation, source generators, and build automation. The site combines a project catalogue, release information, and unified documentation aggregated from the product repositories.',
            'See the projects catalogue for the full product family, the releases page for GitHub and NuGet version information, and the documentation portal for per-project guides.',
          ].join('\n\n'),
          optionalLinks: [
            {
              label: 'GitHub organisation',
              url: SITE.githubUrl,
              description: 'All public repositories and issue trackers.',
            },
            {
              label: 'NuGet packages',
              url: `${SITE.nugetUrl}/search?q=purview`,
              description: 'Published packages on nuget.org.',
            },
            {
              label: 'Projects catalogue',
              url: absoluteUrl('/projects/'),
              description: 'The Purview-Dev product family.',
            },
            {
              label: 'Releases',
              url: absoluteUrl('/releases/'),
              description: 'GitHub and NuGet release information.',
            },
          ],
          promote: ['index*'],
          demote: [],
          exclude: ['dotnet-logging-source-generators/**'],
          minify: {
            note: true,
            tip: true,
            caution: false,
            danger: false,
            details: true,
          },
          // The aggregated documentation is plain markdown; emit it without an
          // HTML round-trip so code blocks and badges survive intact.
          rawContent: true,
        }),
      ],
      head: HEAD,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
