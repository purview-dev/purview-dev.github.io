import type { ResolvedProject } from './manifest/load';

/** How a project's primary NuGet package is consumed. */
export type InstallKind = 'nuget' | 'msbuild-sdk' | 'dotnet-tool';

/** Anchor id for a package's install section, used to link from the packages table. */
export function installAnchorId(packageId: string): string {
  return `install-${packageId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** A single copyable install snippet. */
export interface InstallOption {
  /** Short name for the snippet, e.g. "Directory.Packages.props". */
  label: string;
  /** Optional one-line hint shown under the label. */
  detail?: string;
  /** Copyable install snippet (may span multiple lines). */
  code: string;
}

/** A tab in the Install guide, grouping one or more related snippets. */
export interface InstallTab {
  /** Short name for the install method, e.g. "CPM". */
  label: string;
  /** Optional one-line hint shown for the whole tab. */
  detail?: string;
  /** One or more copyable snippets for this method. */
  snippets: InstallOption[];
}

/** Resolve the install kind for a project, defaulting to a regular NuGet package. */
export function installKindFor(project: Pick<ResolvedProject, 'install'>): InstallKind {
  return project.install;
}

/** Version placeholder used when no published version is available yet. */
const VERSION_PLACEHOLDER = '<version>';

/** Interpolate the latest version, falling back to a placeholder. */
function withVersion(version: string | null): string {
  return version ?? VERSION_PLACEHOLDER;
}

function nugetTabs(packageId: string, version: string | null): InstallTab[] {
  return [
    {
      label: '.NET CLI',
      snippets: [
        {
          label: '.NET CLI',
          code: `dotnet add package ${packageId}`,
        },
      ],
    },
    {
      label: 'CPM',
      detail: 'Central Package Management',
      snippets: [
        {
          label: 'Directory.Packages.props',
          detail: 'Add to your central package file.',
          code: `<PackageVersion Include="${packageId}" Version="${withVersion(version)}" />`,
        },
        {
          label: 'Project file',
          detail: 'The version is resolved from central package management.',
          code: `<PackageReference Include="${packageId}" />`,
        },
      ],
    },
    {
      label: 'PackageReference',
      snippets: [
        {
          label: 'PackageReference',
          code: `<PackageReference Include="${packageId}" Version="${withVersion(version)}" />`,
        },
      ],
    },
    {
      label: 'File-Based Apps',
      detail: 'Reference a package from a file-based app.',
      snippets: [
        {
          label: 'File-Based Apps',
          code: `#:package ${packageId}@${withVersion(version)}`,
        },
      ],
    },
    {
      label: 'Script & interactive',
      detail: 'Load the package in C# scripts and notebooks.',
      snippets: [
        {
          label: 'Script & interactive',
          code: `#r "nuget: ${packageId}, ${withVersion(version)}"`,
        },
      ],
    },
    {
      label: 'PMC',
      detail: 'Run from the Package Manager Console.',
      snippets: [
        {
          label: 'PMC',
          code: `Install-Package ${packageId} -Version ${withVersion(version)}`,
        },
      ],
    },
  ];
}

function msbuildSdkTabs(packageId: string, version: string | null): InstallTab[] {
  return [
    {
      label: 'global.json',
      detail: 'Pin the SDK for the whole repository.',
      snippets: [
        {
          label: 'global.json',
          code: `{\n  "msbuild-sdks": {\n    "${packageId}": "${withVersion(version)}"\n  }\n}`,
        },
      ],
    },
    {
      label: 'SDK',
      detail: 'Reference the SDK from an individual project file.',
      snippets: [
        {
          label: 'SDK',
          code: `<Sdk Name="${packageId}" Version="${withVersion(version)}" />`,
        },
      ],
    },
    {
      label: 'File-Based Apps',
      detail: 'Reference the SDK from a file-based app.',
      snippets: [
        {
          label: 'File-Based Apps',
          code: `#:sdk ${packageId}@${withVersion(version)}`,
        },
      ],
    },
  ];
}

function dotnetToolTabs(packageId: string): InstallTab[] {
  return [
    {
      label: 'Global tool',
      snippets: [
        {
          label: 'Global tool',
          code: `dotnet tool install --global ${packageId}`,
        },
      ],
    },
    {
      label: 'Local tool',
      detail: 'Install into a local tool manifest.',
      snippets: [
        {
          label: 'Tool manifest',
          detail: 'Create a local tool manifest first.',
          code: 'dotnet new tool-manifest',
        },
        {
          label: 'Install',
          detail: 'Install the tool into the local manifest.',
          code: `dotnet tool install ${packageId}`,
        },
      ],
    },
  ];
}

/**
 * Build the ordered list of install tabs for a package of the given kind.
 * The order matches the canonical display order on the project page.
 */
export function installTabs(
  kind: InstallKind,
  packageId: string,
  version: string | null,
): InstallTab[] {
  switch (kind) {
    case 'msbuild-sdk':
      return msbuildSdkTabs(packageId, version);
    case 'dotnet-tool':
      return dotnetToolTabs(packageId);
    case 'nuget':
      return nugetTabs(packageId, version);
  }
}
