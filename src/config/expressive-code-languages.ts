/**
 * Languages the site registers with Expressive Code itself, alongside the
 * LikeC4 grammar astroc4 contributes.
 *
 * `gitignore` exists because the aggregated documentation mirror contains
 * `.gitignore` snippets — product repositories fence them as `gitignore` — and
 * neither Shiki nor Expressive Code bundles an ignore-file grammar: without a
 * registration Expressive Code warns that it cannot find the language and falls
 * back to plain text. The grammar covers what a `.gitignore` line actually
 * contains — a whole-line comment, a leading negation, glob wildcards, an
 * escaped character, a character class and the directory suffix.
 *
 * This is the site's own vocabulary, so it stays deliberately small; it is not
 * a general ignore-file grammar. Scopes are the usual TextMate ones, so the
 * theme colours comments and constants the way it colours any other language.
 */
export const gitignoreLanguage = {
  name: 'gitignore',
  scopeName: 'source.gitignore',
  aliases: ['ignore', 'git-ignore'],
  patterns: [{ include: '#comment' }, { include: '#negation' }, { include: '#pattern' }],
  repository: {
    /** A `#` at the start of a line (after optional indent) comments out the line. */
    comment: {
      match: '^\\s*#.*$',
      name: 'comment.line.number-sign.gitignore',
    },
    /** A leading `!` re-includes what an earlier pattern excluded. */
    negation: {
      match: '^\\s*!',
      name: 'keyword.operator.negation.gitignore',
    },
    pattern: {
      patterns: [
        /** `\#`, `\!`, `\ ` and friends: the next character is literal. */
        { match: '\\\\.', name: 'constant.character.escape.gitignore' },
        { match: '\\*\\*|\\*|\\?', name: 'constant.other.wildcard.gitignore' },
        { match: '\\[[^\\]]*\\]', name: 'constant.other.character-class.gitignore' },
        /** A trailing slash matches directories only. */
        { match: '/$', name: 'punctuation.separator.directory.gitignore' },
        { match: '/', name: 'punctuation.separator.path.gitignore' },
      ],
    },
  },
};

/** Everything the site adds to `expressiveCode.shiki.langs` in `astro.config.ts`. */
export const siteLanguages = [gitignoreLanguage];
