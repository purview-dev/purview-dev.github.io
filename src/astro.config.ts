import type { AstroIntegration } from 'astro';

import { satteri } from '@astrojs/markdown-satteri';
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import astroc4 from '@purview-dev/astroc4';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightSidebarTopics from 'starlight-sidebar-topics';

import discoveryIntegration from './config/discovery-integration';
import docsRedirectsIntegration from './config/docs-redirects-integration';
import { mermaidFences } from './config/satteri-mermaid';
import { projectChannelLlmsUrl, projectLlmsUrl } from './src/lib/discovery/urls';
import { readDocsManifest } from './src/lib/docs/aggregate';
import { channelDisplayLabel, channelTopicLabel } from './src/lib/docs/channels';
import { buildProjectTopics } from './src/lib/docs/sidebar';
import { buildLlmsDetails } from './src/lib/llms-details';
import { loadProjects } from './src/lib/manifest/load';
import { SITE, BRAND } from './src/lib/site';
import { displayStatus, type DisplayStatus } from './src/lib/status';
import { absoluteUrl } from './src/lib/urls';

/**
 * Starlight injects `@astrojs/sitemap` unless an integration with that exact
 * name is already registered (see `@astrojs/starlight/dist/index.js`). We
 * generate the sitemap ourselves — partitioned, with content-derived `lastmod`
 * — so this no-op claims the name to stop Starlight's single-file sitemap from
 * overwriting `/sitemap-index.xml`. `discoveryIntegration()` does the work.
 */
const suppressStarlightSitemap: AstroIntegration = { name: '@astrojs/sitemap', hooks: {} };

const projects = loadProjects();
const docsManifest = readDocsManifest();

const docsProjects = projects.filter((project) => project.docs && project.status !== 'archived');
/**
 * Per-project machine-readable bundles are emitted by the discovery integration
 * (see `config/discovery-integration.ts`) at `/projects/<id>/llms.txt` and
 * `/projects/<id>/llms-full.txt`, following the llms.txt convention at the
 * per-project scope. The `starlight-llms-txt` plugin below only produces the
 * site-wide `/llms*.txt` files.
 */
/**
 * Sidebar badges for the two "not for production" states. The value comes from
 * the shared display status (ADR 0004), so the docs sidebar, the project page
 * and the catalogue filter cannot disagree about how a project is flagged.
 */
const topicBadges: Partial<Record<DisplayStatus, { text: string; variant: 'caution' | 'danger' }>> =
  {
    preview: { text: 'Preview', variant: 'caution' },
    experimental: { text: 'Experimental', variant: 'danger' },
  };
const sidebarTopics = [
  { label: 'Documentation home', link: '/docs/' },
  // Each published documentation version is its own topic (ADR 0009): the same
  // product at a different version is a different documentation set, with its
  // own pages, its own sidebar and its own machine-readable bundle. A project
  // with one channel therefore produces exactly the topic it always did.
  ...docsProjects.flatMap((project) =>
    buildProjectTopics(project, docsManifest).map((topic) => ({
      label: topic.label,
      link: topic.link,
      badge: topicBadges[displayStatus(project)],
      items: topic.items,
    })),
  ),
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
  markdown: {
    // Astro 7.4 made Sätteri the default processor. Astroc4's ```likec4 fence
    // transform is a Sätteri mdast plugin appended to this processor, and the
    // Mermaid bridge had to move with it (see config/satteri-mermaid.ts).
    processor: satteri({ mdastPlugins: [mermaidFences] }),
  },
  integrations: [
    // Two JSX renderers are in play: Preact for the site's own islands, React
    // for astroc4's LikeC4 islands. Without include/exclude each integration
    // claims every .tsx file and Astro warns that behaviour is undefined.
    preact({ exclude: ['**/node_modules/**'] }),
    react({ include: ['**/node_modules/**'] }),
    suppressStarlightSitemap,
    // Registered before discovery so a retired channel's redirect pages exist
    // before the sitemap/llms artifacts are derived (Astro's page list never
    // includes them, so they stay out of every generated index).
    docsRedirectsIntegration(),
    discoveryIntegration(),
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
        styleOverrides: {
          borderRadius: '0.75rem',
          codeFontFamily: 'var(--font-mono)',
          uiFontFamily: 'var(--font-sans)',
          frames: {
            // Literal hex, not `var(--color-brand)`: Expressive Code parses these
            // as colors (e.g. for opacity/contrast math), which breaks on CSS
            // custom properties. #8b3dff is the brand purple in both themes.
            editorActiveTabIndicatorTopColor: '#8b3dff',
            editorActiveTabIndicatorBottomColor: '#8b3dff',
            terminalTitlebarDotsForeground: '#8b3dff',
            terminalTitlebarDotsOpacity: '0.6',
          },
        },
      },
      components: {
        Head: './src/components/starlight/Head.astro',
        Header: './src/components/starlight/Header.astro',
        PageFrame: './src/components/starlight/PageFrame.astro',
        EditLink: './src/components/starlight/EditLink.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        Search: './src/components/starlight/Search.astro',
        Sidebar: './src/components/starlight/Sidebar.astro',
      },
      plugins: [
        // The live astroc4 demo (src/pages/examples/astroc4.mdx) is the site
        // dogfooding the plugin it catalogues: real fences and real views.
        astroc4({
          vitePlugin: { workspace: 'src/likec4' },
          highlighting: { ref: 'v1.60.0' },
        }),
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
          projectName: SITE.fullName,
          description: SITE.description,
          // The suite-level narrative is generated from the catalogue (see
          // `src/lib/llms-details.ts`) rather than authored here, so it cannot
          // drift from the projects the site actually ships.
          details: buildLlmsDetails(projects),
          optionalLinks: [
            {
              label: 'GitHub organisation',
              url: SITE.githubUrl,
              description: 'All public repositories and issue trackers.',
            },
            {
              label: 'NuGet packages',
              url: `${SITE.nugetUrl}/packages?q=purview+kieronlanning`,
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
            // Per-version machine-readable bundles, emitted by the discovery
            // integration at /projects/<id>[/<channel>]/llms.txt. Each published
            // documentation version advertises its own bundle, so a model can
            // read the version it needs instead of one corpus with two versions
            // of the same page.
            ...docsProjects.flatMap((project) => {
              const channels =
                docsManifest?.projects.find((entry) => entry.projectId === project.id)?.channels ??
                [];
              if (channels.length === 0) {
                return [
                  {
                    label: project.name,
                    url: projectLlmsUrl(project.id),
                    description: project.shortDescription,
                  },
                ];
              }
              return channels.map((channel) => ({
                label: channelTopicLabel(project.name, channel, channels.length),
                url: projectChannelLlmsUrl(project.id, channel.id, channel.default),
                description: `${project.shortDescription} (${channelDisplayLabel(channel)})`,
              }));
            }),
          ],
          promote: ['index*', 'docs/*/index'],
          demote: [],
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
    // MDX must come after Starlight: Starlight registers
    // astro-expressive-code, and the MDX integration has to see it to
    // highlight code blocks on .mdx pages (the live astroc4 example).
    mdx(),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // LikeC4's React bundle imports React's CommonJS compiler runtime with
        // a named `c` export. Vite 8's Rolldown optimiser does not expose that
        // export from the development build, so the islands fail to hydrate.
        // The bridge is the same `useMemoCache` call in ESM form.
        'react/compiler-runtime': fileURLToPath(
          new URL('./config/react-compiler-runtime.ts', import.meta.url),
        ),
      },
    },
    optimizeDeps: {
      // LikeC4 is a dependency added at build time; listing its React entry
      // and the React runtime means a cold dev start pre-bundles them instead
      // of serving them raw and producing "504 Outdated Optimize Dep".
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'likec4/react',
        '@likec4/core',
      ],
    },
  },
});
