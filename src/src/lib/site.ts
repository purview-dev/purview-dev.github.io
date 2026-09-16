export const SITE = {
  name: 'Purview',
  fullName: 'Purview Dev',
  orgName: 'Purview Development',
  tagline: 'Excellent useful tools.',
  domain: 'purview.dev',
  url: process.env.SITE_URL ?? 'https://purview.dev',
  githubOrg: 'purview-dev',
  githubUrl: 'https://github.com/purview-dev',
  nugetUrl: 'https://www.nuget.org',
  description:
    'Purview Dev builds developer tooling for .NET: event sourcing, telemetry, validation, source generators, and build automation — designed to be fast, typed, and painless to adopt.',
} as const;

export const BRAND = {
  purple: '#8B3DFF',
  purpleDeep: '#6820D2',
  vaporEdge: '#B991FF',
  inkLight: '#17141F',
  inkDark: '#FFFFFF',
} as const;

export const OWNER = 'purview-dev';
