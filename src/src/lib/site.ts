export const SITE = {
  name: 'Purview',
  fullName: 'Purview Dev',
  orgName: 'Purview Development',
  tagline: 'Making development easier.',
  domain: 'purview.dev',
  url: process.env.SITE_URL ?? 'https://purview.dev',
  githubOrg: 'purview-dev',
  githubUrl: 'https://github.com/purview-dev',
  nugetUrl: 'https://www.nuget.org',
  description:
    'Open-source .NET tools shaped by real projects — built to remove repetition, catch problems earlier, and make development easier.',
} as const;

export const BRAND = {
  purple: '#8B3DFF',
  purpleDeep: '#6820D2',
  vaporEdge: '#B991FF',
  inkLight: '#17141F',
  inkDark: '#FFFFFF',
} as const;

export const OWNER = 'purview-dev';
