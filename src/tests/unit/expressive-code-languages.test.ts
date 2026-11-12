import { describe, expect, test } from 'bun:test';

import { gitignoreLanguage, siteLanguages } from '../../config/expressive-code-languages';

/**
 * The `gitignore` language exists so a ````gitignore` fence in the aggregated
 * documentation mirror is highlighted instead of falling back to plain text.
 * Expressive Code resolves a fence's language by `name` and `aliases`, and the
 * theme colours it by scope — so both halves are the contract these cases pin.
 */
interface GrammarPattern {
  match?: string;
  name?: string;
  patterns?: GrammarPattern[];
}

const repository = gitignoreLanguage.repository as Record<string, GrammarPattern>;

/** Every `match` pattern in the grammar, keyed by the scope it assigns. */
const matchers = new Map<string, RegExp>();
for (const entry of [
  repository.comment,
  repository.negation,
  ...(repository.pattern?.patterns ?? []),
]) {
  if (entry?.match && entry.name) {
    matchers.set(entry.name, new RegExp(entry.match));
  }
}

/** The matcher for a scope; an unscoped pattern never matches, so a rename fails here. */
const matcher = (scope: string) => matchers.get(`${scope}.gitignore`) ?? /(?!)/;

describe('gitignore language registration', () => {
  test('is registered under the name and aliases a fence can use', () => {
    expect(gitignoreLanguage.name).toBe('gitignore');
    expect(gitignoreLanguage.scopeName).toBe('source.gitignore');
    expect(gitignoreLanguage.aliases).toContain('ignore');
    expect(siteLanguages).toContain(gitignoreLanguage);
  });

  test('comments out a whole line, but not an escaped hash', () => {
    const comment = matcher('comment.line.number-sign');
    expect(comment.test('# Replaces **/likec4/gen/ and **/erd/gen/')).toBe(true);
    expect(comment.test('  # indented')).toBe(true);
    expect(comment.test('\\#not-a-comment')).toBe(false);
    expect(comment.test('**/.aspirec4/')).toBe(false);
  });

  test('marks a leading negation, not an escaped or mid-line one', () => {
    const negation = matcher('keyword.operator.negation');
    expect(negation.test('!*.log')).toBe(true);
    expect(negation.test('  !*.log')).toBe(true);
    expect(negation.test('*.log')).toBe(false);
    expect(negation.test('log!')).toBe(false);
  });

  test('scopes the globs of a pattern', () => {
    const glob = matcher('constant.other.wildcard');
    expect(glob.test('**/node_modules')).toBe(true);
    expect(glob.test('*.env*')).toBe(true);
    expect(glob.test('file?.tmp')).toBe(true);
    expect(glob.test('build/out')).toBe(false);
  });

  test('scopes escapes, character classes and the directory suffix', () => {
    expect(matcher('constant.character.escape').test('\\!important')).toBe(true);
    expect(matcher('constant.other.character-class').test('file[0-9].tmp')).toBe(true);
    const directory = matcher('punctuation.separator.directory');
    expect(directory.test('build/')).toBe(true);
    expect(directory.test('build/file')).toBe(false);
  });
});
