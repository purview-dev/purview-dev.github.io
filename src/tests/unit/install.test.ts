import { describe, expect, test } from 'bun:test';

import { installKindFor, installOptions } from '../../src/lib/install';

describe('installKindFor', () => {
  test('returns the declared install kind', () => {
    expect(installKindFor({ install: 'dotnet-tool' })).toBe('dotnet-tool');
    expect(installKindFor({ install: 'msbuild-sdk' })).toBe('msbuild-sdk');
    expect(installKindFor({ install: 'nuget' })).toBe('nuget');
  });
});

describe('installOptions — nuget', () => {
  test('renders every option in canonical order with the latest version', () => {
    const options = installOptions('nuget', 'Purview.EventSourcing', '2.0.0-prerelease.32');
    expect(options.map((option) => option.label)).toEqual([
      '.NET CLI',
      'CPM — Directory.Packages.props',
      'CPM — Project file',
      'PackageReference',
      'File-Based Apps',
      'Script & interactive',
      'PMC (NuGet\\Install-Package.ps1)',
    ]);
    expect(options[0]?.code).toBe('dotnet add package Purview.EventSourcing');
    expect(options[1]?.code).toBe(
      '<PackageVersion Include="Purview.EventSourcing" Version="2.0.0-prerelease.32" />',
    );
    expect(options[2]?.code).toBe('<PackageReference Include="Purview.EventSourcing" />');
    expect(options[3]?.code).toBe(
      '<PackageReference Include="Purview.EventSourcing" Version="2.0.0-prerelease.32" />',
    );
    expect(options[4]?.code).toBe('#:package Purview.EventSourcing@2.0.0-prerelease.32');
    expect(options[5]?.code).toBe('#r "nuget: Purview.EventSourcing, 2.0.0-prerelease.32"');
    expect(options[6]?.code).toBe(
      'Install-Package Purview.EventSourcing -Version 2.0.0-prerelease.32',
    );
  });

  test('falls back to a version placeholder when no version is known', () => {
    const options = installOptions('nuget', 'Purview.Foo', null);
    expect(options[1]?.code).toBe('<PackageVersion Include="Purview.Foo" Version="<version>" />');
    expect(options[4]?.code).toBe('#:package Purview.Foo@<version>');
    expect(options[0]?.code).toBe('dotnet add package Purview.Foo');
  });
});

describe('installOptions — msbuild-sdk', () => {
  test('renders the SDK options with version interpolation', () => {
    const options = installOptions('msbuild-sdk', 'Purview.BuildSdk', '1.0.0-prerelease.56');
    expect(options.map((option) => option.label)).toEqual([
      'global.json',
      'SDK',
      'File-Based Apps',
    ]);
    expect(options[0]?.code).toBe(
      '{\n  "msbuild-sdks": {\n    "Purview.BuildSdk": "1.0.0-prerelease.56"\n  }\n}',
    );
    expect(options[1]?.code).toBe('<Sdk Name="Purview.BuildSdk" Version="1.0.0-prerelease.56" />');
    expect(options[2]?.code).toBe('#:sdk Purview.BuildSdk@1.0.0-prerelease.56');
  });
});

describe('installOptions — dotnet-tool', () => {
  test('renders global and local tool install commands', () => {
    const options = installOptions('dotnet-tool', 'Purview.Build', '0.2.4');
    expect(options.map((option) => option.label)).toEqual([
      '.NET CLI (Global)',
      '.NET CLI (Local)',
      '.NET CLI (Local)',
    ]);
    expect(options[0]?.code).toBe('dotnet tool install --global Purview.Build');
    expect(options[1]?.code).toBe('dotnet new tool-manifest');
    expect(options[2]?.code).toBe('dotnet tool install Purview.Build');
  });
});
