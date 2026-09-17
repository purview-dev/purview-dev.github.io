import type { ResolvedProject } from './manifest/load';

/** How a project's primary NuGet package is consumed. */
export type InstallKind = 'nuget' | 'msbuild-sdk' | 'dotnet-tool';

export interface InstallOption {
  /** Short name for the install target, e.g. ".NET CLI". */
  label: string;
  /** Optional one-line hint shown under the label. */
  detail?: string;
  /** Copyable install snippet (may span multiple lines). */
  code: string;
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

function nugetOptions(packageId: string, version: string | null): InstallOption[] {
  return [
    {
      label: '.NET CLI',
      code: `dotnet add package ${packageId}`,
    },
    {
      label: 'CPM — Directory.Packages.props',
      detail: 'Add to your central package file.',
      code: `<PackageVersion Include="${packageId}" Version="${withVersion(version)}" />`,
    },
    {
      label: 'CPM — Project file',
      detail: 'The version is resolved from central package management.',
      code: `<PackageReference Include="${packageId}" />`,
    },
    {
      label: 'PackageReference',
      code: `<PackageReference Include="${packageId}" Version="${withVersion(version)}" />`,
    },
    {
      label: 'File-Based Apps',
      detail: 'Reference a package from a file-based app.',
      code: `#:package ${packageId}@${withVersion(version)}`,
    },
    {
      label: 'Script & interactive',
      detail: 'Load the package in C# scripts and notebooks.',
      code: `#r "nuget: ${packageId}, ${withVersion(version)}"`,
    },
    {
      label: 'PMC (NuGet\\Install-Package.ps1)',
      detail: 'Run from the Package Manager Console.',
      code: `Install-Package ${packageId} -Version ${withVersion(version)}`,
    },
  ];
}

function msbuildSdkOptions(packageId: string, version: string | null): InstallOption[] {
  return [
    {
      label: 'global.json',
      detail: 'Pin the SDK for the whole repository.',
      code: `{\n  "msbuild-sdks": {\n    "${packageId}": "${withVersion(version)}"\n  }\n}`,
    },
    {
      label: 'SDK',
      detail: 'Reference the SDK from an individual project file.',
      code: `<Sdk Name="${packageId}" Version="${withVersion(version)}" />`,
    },
    {
      label: 'File-Based Apps',
      detail: 'Reference the SDK from a file-based app.',
      code: `#:sdk ${packageId}@${withVersion(version)}`,
    },
  ];
}

function dotnetToolOptions(packageId: string): InstallOption[] {
  return [
    {
      label: '.NET CLI (Global)',
      code: `dotnet tool install --global ${packageId}`,
    },
    {
      label: '.NET CLI (Local)',
      detail: 'Create a local tool manifest first.',
      code: 'dotnet new tool-manifest',
    },
    {
      label: '.NET CLI (Local)',
      detail: 'Install the tool into the local manifest.',
      code: `dotnet tool install ${packageId}`,
    },
  ];
}

/**
 * Build the ordered list of install options for a package of the given kind.
 * The order matches the canonical display order on the project page.
 */
export function installOptions(
  kind: InstallKind,
  packageId: string,
  version: string | null,
): InstallOption[] {
  switch (kind) {
    case 'msbuild-sdk':
      return msbuildSdkOptions(packageId, version);
    case 'dotnet-tool':
      return dotnetToolOptions(packageId);
    case 'nuget':
      return nugetOptions(packageId, version);
  }
}
