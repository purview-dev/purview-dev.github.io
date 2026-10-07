import { describe, expect, test } from 'bun:test';

import {
  diffTargetFrameworks,
  isAnalyzerTargetFramework,
  isAnalyzerTargetFrameworks,
  isRecognizedTargetFramework,
  normalizeTargetFramework,
  normalizeTargetFrameworks,
  runtimeTargetFrameworks,
  selectVersionForTargetFrameworks,
  sortTargetFrameworks,
} from '../../src/lib/releases/target-frameworks';

describe('target framework normalisation', () => {
  test('expands the historical long forms', () => {
    expect(normalizeTargetFramework('.NETStandard2.0')).toBe('netstandard2.0');
    expect(normalizeTargetFramework('.NETFramework4.7.2')).toBe('net472');
    expect(normalizeTargetFramework('.NETCoreApp3.1')).toBe('netcoreapp3.1');
    expect(normalizeTargetFramework('.NET5.0')).toBe('net5.0');
  });

  test('pads a platform version to four components', () => {
    expect(normalizeTargetFramework('net10.0-windows10.0.19041')).toBe(
      'net10.0-windows10.0.19041.0',
    );
    expect(normalizeTargetFramework('net10.0-windows10.0.19041.0')).toBe(
      'net10.0-windows10.0.19041.0',
    );
  });

  test('lowercases and de-duplicates, sorted', () => {
    expect(normalizeTargetFrameworks(['NET10.0', 'net8.0', 'net10.0'])).toEqual([
      'net10.0',
      'net8.0',
    ]);
  });
});

describe('target framework classification', () => {
  test('recognises TFMs and the msbuild sentinel', () => {
    for (const value of [
      'net8.0',
      'net10.0',
      'net472',
      'netstandard2.0',
      'netcoreapp3.1',
      'net10.0-windows10.0.19041.0',
      'msbuild',
    ]) {
      expect(isRecognizedTargetFramework(value)).toBe(true);
    }
    expect(isRecognizedTargetFramework('dotnet')).toBe(false);
    expect(isRecognizedTargetFramework('net10.0 windows')).toBe(false);
  });

  test('identifies analyzer frameworks', () => {
    expect(isAnalyzerTargetFramework('netstandard2.0')).toBe(true);
    expect(isAnalyzerTargetFramework('.NETStandard2.0')).toBe(true);
    expect(isAnalyzerTargetFramework('net10.0')).toBe(false);
    expect(isAnalyzerTargetFrameworks(['.NETStandard2.0'])).toBe(true);
    expect(isAnalyzerTargetFrameworks(['netstandard2.0', 'net8.0'])).toBe(false);
    expect(isAnalyzerTargetFrameworks([])).toBe(false);
  });

  test('removes sentinels and, optionally, analyzer frameworks', () => {
    expect(runtimeTargetFrameworks(['msbuild'])).toEqual([]);
    expect(
      runtimeTargetFrameworks(['net8.0', 'netstandard2.0'], { excludeAnalyzer: true }),
    ).toEqual(['net8.0']);
  });
});

describe('natural target framework ordering', () => {
  test('orders by family and numeric version, not lexicographically', () => {
    expect(sortTargetFrameworks(['net10.0', 'net8.0', 'net9.0', 'net11.0'])).toEqual([
      'net8.0',
      'net9.0',
      'net10.0',
      'net11.0',
    ]);
  });

  test('places the base framework before its platform variant', () => {
    expect(sortTargetFrameworks(['net10.0-windows10.0.19041.0', 'net10.0'])).toEqual([
      'net10.0',
      'net10.0-windows10.0.19041.0',
    ]);
  });

  test('normalises before sorting', () => {
    expect(sortTargetFrameworks(['.NETStandard2.0', 'net8.0'])).toEqual([
      'net8.0',
      'netstandard2.0',
    ]);
  });
});

describe('target framework diff', () => {
  test('reports missing and extra frameworks', () => {
    expect(diffTargetFrameworks(['net8.0', 'net9.0'], ['net8.0', 'net10.0'])).toEqual({
      missing: ['net10.0'],
      extra: ['net9.0'],
    });
  });

  test('normalises both sides before comparing', () => {
    expect(
      diffTargetFrameworks(['net10.0-windows10.0.19041.0'], ['net10.0-windows10.0.19041']),
    ).toEqual({ missing: [], extra: [] });
    expect(diffTargetFrameworks(['.NETStandard2.0'], ['netstandard2.0'])).toEqual({
      missing: [],
      extra: [],
    });
  });
});

describe('version selection for nuspec lookup', () => {
  test('prefers the newest stable version', () => {
    expect(selectVersionForTargetFrameworks(['2.0.0-prerelease.9', '2.0.1', '2.0.0'])).toBe(
      '2.0.1',
    );
  });

  test('falls back to the newest prerelease', () => {
    expect(selectVersionForTargetFrameworks(['2.0.0-prerelease.1', '2.0.0-prerelease.9'])).toBe(
      '2.0.0-prerelease.9',
    );
  });

  test('returns null when nothing is published', () => {
    expect(selectVersionForTargetFrameworks([])).toBeNull();
  });
});
