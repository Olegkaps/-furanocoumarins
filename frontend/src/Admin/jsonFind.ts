export type JsonMatch = { start: number; end: number };
export type FindOptions = { matchCase: boolean; wholeWord: boolean };

// Literal matching keeps arbitrary JSON text searchable without regex syntax.
export function findJsonMatches(text: string, query: string, options: FindOptions): JsonMatch[] {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.matchCase ? "gu" : "giu");
  const word = /[\p{L}\p{N}_]/u;
  return Array.from(text.matchAll(expression), match => ({ start: match.index, end: match.index + match[0].length }))
    .filter(({ start, end }) => !options.wholeWord ||
      (!word.test(Array.from(text.slice(Math.max(0, start - 2), start)).at(-1) ?? "") && !word.test(Array.from(text.slice(end, end + 2))[0] ?? "")));
}

export function replaceJsonMatches(text: string, matches: JsonMatch[], replacement: string): string {
  let end = 0;
  const pieces = matches.map(match => {
    const piece = text.slice(end, match.start) + replacement;
    end = match.end;
    return piece;
  });
  return pieces.join("") + text.slice(end);
}

export function nextJsonMatch(count: number, active: number, backward = false): number {
  return count ? (active + (backward ? -1 : 1) + count) % count : 0;
}
