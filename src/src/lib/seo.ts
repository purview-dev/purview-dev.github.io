const MIN_LENGTH = 120;
const MAX_LENGTH = 160;

/** Fit a meta description into the 120-160 character range search engines expect. */
export function metaDescription(
  text: string,
  context = 'Open-source .NET tooling from Purview Dev.',
): string {
  let result = text.replace(/\s+/g, ' ').trim();
  if (result.length < MIN_LENGTH) {
    const base = /[.!?…]$/.test(result) ? result : `${result}.`;
    result = `${base} ${context}`;
  }
  if (result.length > MAX_LENGTH) {
    const cut = result.slice(0, MAX_LENGTH - 1);
    const lastSpace = cut.lastIndexOf(' ');
    result = `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/, '')}…`;
  }
  return result;
}
