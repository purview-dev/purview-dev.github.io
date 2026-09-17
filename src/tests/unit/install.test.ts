import { describe, expect, test } from 'bun:test';

import { installKindFor, installTabs } from '../../src/lib/install';

describe('installKindFor', () => {
  test('returns the declared install kind', () => {
    expect(installKindFor({ install: 'dotnet-tool' })).toBe('dotnet-tool');
    expect(installKindFor({ install: 'msbuild-sdk' })).toBe('msbuild-sdk');
    expect(installKindFor({ install: 'nuget' })).toBe('nuget');
  });
});

describe('installTabs — nuget', () => {
  test('renders every tab in canonical order with the latest version', () => {
    const tabs = installTabs('nuget', 'Purview.EventSourcing', '2.0.0-prerelease.32');
    expect(tabs.map((tab) => tab.label)).toEqual([
      '.NET CLI',
      'CPM',
      'PackageReference',
      'File-Based Apps',
      'Script & interactive',
      'PMC',
    ]);
    expect(tabs[0]?.snippets[0]?.code).toBe('dotnet add package Purview.EventSourcing');

    const cpm = tabs[1];
    expect(cpm?.label).toBe('CPM');
    expect(cpm?.snippets.map((snippet) => snippet.label)).toEqual([
      'Directory.Packages.props',
      'Project file',
    ]);
    expect(cpm?.snippets[0]?.code).toBe(
      '<PackageVersion Include="Purview.EventSourcing" Version="2.0.0-prerelease.32" />',
    );
    expect(cpm?.snippets[1]?.code).toBe('<PackageReference Include="Purview.EventSourcing" />');

    expect(tabs[2]?.snippets[0]?.code).toBe(
      '<PackageReference Include="Purview.EventSourcing" Version="2.0.0-prerelease.32" />',
    );
    expect(tabs[3]?.snippets[0]?.code).toBe('#:package Purview.EventSourcing@2.0.0-prerelease.32');
    expect(tabs[4]?.snippets[0]?.code).toBe(
      '#r "nuget: Purview.EventSourcing, 2.0.0-prerelease.32"',
    );
    expect(tabs[5]?.snippets[0]?.code).toBe(
      'Install-Package Purview.EventSourcing -Version 2.0.0-prerelease.32',
    );
  });

  test('falls back to a version placeholder when no version is known', () => {
    const tabs = installTabs('nuget', 'Purview.Foo', null);
    expect(tabs[1]?.snippets[0]?.code).toBe(
      '<PackageVersion Include="Purview.Foo" Version="<version>" />',
    );
    expect(tabs[3]?.snippets[0]?.code).toBe('#:package Purview.Foo@<version>');
    expect(tabs[0]?.snippets[0]?.code).toBe('dotnet add package Purview.Foo');
  });
});

describe('installTabs — msbuild-sdk', () => {
  test('renders the SDK tabs with version interpolation', () => {
    const tabs = installTabs('msbuild-sdk', 'Purview.BuildSdk', '1.0.0-prerelease.56');
    expect(tabs.map((tab) => tab.label)).toEqual(['global.json', 'SDK', 'File-Based Apps']);
    expect(tabs[0]?.snippets[0]?.code).toBe(
      '{\n  "msbuild-sdks": {\n    "Purview.BuildSdk": "1.0.0-prerelease.56"\n  }\n}',
    );
    expect(tabs[1]?.snippets[0]?.code).toBe(
      '<Sdk Name="Purview.BuildSdk" Version="1.0.0-prerelease.56" />',
    );
    expect(tabs[2]?.snippets[0]?.code).toBe('#:sdk Purview.BuildSdk@1.0.0-prerelease.56');
  });
});

describe('installTabs — dotnet-tool', () => {
  test('renders global and local tool tabs with grouped local steps', () => {
    const tabs = installTabs('dotnet-tool', 'Purview.Build', '0.2.4');
    expect(tabs.map((tab) => tab.label)).toEqual(['Global tool', 'Local tool']);
    expect(tabs[0]?.snippets[0]?.code).toBe('dotnet tool install --global Purview.Build');

    const local = tabs[1];
    expect(local?.snippets.map((snippet) => snippet.label)).toEqual(['Tool manifest', 'Install']);
    expect(local?.snippets[0]?.code).toBe('dotnet new tool-manifest');
    expect(local?.snippets[1]?.code).toBe('dotnet tool install Purview.Build');
  });
});
