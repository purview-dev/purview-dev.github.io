import { describe, expect, test } from 'bun:test';

import { parseInlineCode, parseProse } from '../../src/lib/prose';

describe('inline code', () => {
  test('splits single-backtick spans from the surrounding text', () => {
    expect(parseInlineCode('The C# 15 `union` keyword lowers to `object?`.')).toEqual([
      { code: false, text: 'The C# 15 ' },
      { code: true, text: 'union' },
      { code: false, text: ' keyword lowers to ' },
      { code: true, text: 'object?' },
      { code: false, text: '.' },
    ]);
  });

  test('a longer run can contain a backtick and strips one padding space', () => {
    expect(parseInlineCode('use `` a`b `` here')).toEqual([
      { code: false, text: 'use ' },
      { code: true, text: 'a`b' },
      { code: false, text: ' here' },
    ]);
  });

  test('a run only closes on a run of the same length', () => {
    expect(parseInlineCode('``a`b``')).toEqual([{ code: true, text: 'a`b' }]);
  });

  test('an unmatched backtick stays literal text', () => {
    expect(parseInlineCode("it's a ` stray")).toEqual([{ code: false, text: "it's a ` stray" }]);
  });

  test('a span folded across lines reads as one line', () => {
    expect(parseInlineCode('`is`/`null\npatterns`')).toEqual([
      { code: true, text: 'is' },
      { code: false, text: '/' },
      { code: true, text: 'null patterns' },
    ]);
  });
});

describe('prose blocks', () => {
  test('a folded scalar is one paragraph', () => {
    expect(parseProse('One `a` line.')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { code: false, text: 'One ' },
          { code: true, text: 'a' },
          { code: false, text: ' line.' },
        ],
      },
    ]);
  });

  test('blank lines separate paragraphs', () => {
    expect(parseProse('First.\n\nSecond.').map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
    ]);
  });

  test('a fenced block keeps its lines and language', () => {
    expect(parseProse('Before:\n\n```csharp\nvar x = 1;\n  var y = 2;\n```\nAfter.')).toEqual([
      { kind: 'paragraph', inlines: [{ code: false, text: 'Before:' }] },
      { kind: 'code', code: 'var x = 1;\n  var y = 2;', language: 'csharp' },
      { kind: 'paragraph', inlines: [{ code: false, text: 'After.' }] },
    ]);
  });

  test('a fence closes only on a run at least as long as the opener', () => {
    expect(parseProse('~~~~\n```\n~~~\n~~~~')).toEqual([
      { kind: 'code', code: '```\n~~~', language: undefined },
    ]);
  });

  test('an unclosed fence runs to the end of the text', () => {
    expect(parseProse('```\ncode')).toEqual([{ kind: 'code', code: 'code', language: undefined }]);
  });

  test('triple backticks inside a line are an inline span, not a fence', () => {
    expect(parseProse('```x``` inline')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { code: true, text: 'x' },
          { code: false, text: ' inline' },
        ],
      },
    ]);
  });
});
