export type DelimiterPair = { open: number; close: number; delimiter: "(" | "'" };

type Edit = { value: string; caret: number; pairs: DelimiterPair[] };

function quotedAt(value: string, end: number) {
  let quoted = false;
  for (let index = 0; index < end; index++) {
    if (value[index] !== "'") continue;
    if (value[index + 1] === "'") { index++; continue; }
    quoted = !quoted;
  }
  return quoted;
}

export function insertDelimiter(value: string, start: number, end: number, delimiter: "(" | "'", pairs: DelimiterPair[]): Edit {
  const selection = value.slice(start, end);
  const closing = delimiter === "(" ? ")" : "'";
  const next = `${value.slice(0, start)}${delimiter}${selection}${closing}${value.slice(end)}`;
  // Inside a literal, a quote represents an escaped apostrophe. Keep the caret
  // after the pair so subsequent text stays in that literal.
  const caret = delimiter === "'" && start === end && quotedAt(value, start) ? start + 2 : start + 1;
  // The selected text is retained between the new delimiters. Existing pairs
  // therefore remain valid, but delimiters after the selection move by two and
  // delimiters within it move past the new opening character.
  const rebased = pairs.map((pair) => ({
    ...pair,
    open: pair.open < start ? pair.open : pair.open >= end ? pair.open + 2 : pair.open + 1,
    close: pair.close < start ? pair.close : pair.close >= end ? pair.close + 2 : pair.close + 1,
  }));
  return { value: next, caret, pairs: [...rebased, { open: start, close: start + selection.length + 1, delimiter }] };
}

// Completion replaces the token under the caret, unlike typed input, which
// wraps a selection.  Rebase tracked pairs for that replacement first, then
// create the same tracked pair that a typed delimiter would create.
export function replaceSuggestionWithDelimiter(value: string, start: number, end: number, delimiter: "(" | "'", pairs: DelimiterPair[]): Edit {
  const closing = delimiter === "(" ? ")" : "'";
  const existing = pairs.find((pair) => pair.delimiter === delimiter && pair.close === start && value[start] === closing);
  if (existing && end === start + 1) return appendCompletionSpace(value, start, start, pairs);
  const replaced = `${value.slice(0, start)}${value.slice(end)}`;
  const inserted = insertDelimiter(replaced, start, start, delimiter, reconcileDelimiterPairs(value, replaced, pairs));
  const close = inserted.pairs.at(-1)?.close;
  return close === undefined ? inserted : appendCompletionSpace(inserted.value, close, inserted.caret, inserted.pairs);
}

function appendCompletionSpace(value: string, close: number, caret: number, pairs: DelimiterPair[]): Edit {
  if (/^\s/.test(value.slice(close + 1))) return { value, caret, pairs };
  const next = `${value.slice(0, close + 1)} ${value.slice(close + 1)}`;
  return { value: next, caret, pairs: reconcileDelimiterPairs(value, next, pairs) };
}

export function typeAutoClosingQuote(value: string, caret: number, pairs: DelimiterPair[]): Edit | null {
  const pair = pairs.find(({ close, delimiter }) => close === caret && delimiter === "'");
  if (!pair) return null;
  if (!quotedAt(value, caret)) return { value, caret: caret + 1, pairs };
  // At an auto-closing literal quote, another apostrophe is an escaped literal
  // apostrophe. Insert it before the closer instead of swallowing the key.
  const next = `${value.slice(0, caret)}''${value.slice(caret)}`;
  return {
    value: next,
    caret: caret + 2,
    // This is a known insertion immediately before the existing closer. A
    // generic text diff cannot reliably rebase repeated quote characters.
    pairs: [...pairs.map((candidate) => ({
      ...candidate,
      open: candidate.open >= caret ? candidate.open + 2 : candidate.open,
      close: candidate.close >= caret ? candidate.close + 2 : candidate.close,
    })), { open: caret, close: caret + 1, delimiter: "'" }],
  };
}

export function registerAutoQuotePair(value: string, caret: number, pairs: DelimiterPair[]) {
  const open = caret - 1;
  if (value[open] !== "'" || value[caret] !== "'" || pairs.some(pair => pair.open === open && pair.close === caret)) return pairs;
  return [...pairs, { open, close: caret, delimiter: "'" as const }];
}

export function removePairedDelimiter(value: string, caret: number, key: "Backspace" | "Delete", pairs: DelimiterPair[]): Edit | null {
  const position = key === "Backspace" ? caret - 1 : caret;
  const pair = pairs.find(({ open, close }) => position === open || position === close);
  if (!pair) return null;
  const next = `${value.slice(0, pair.open)}${value.slice(pair.open + 1, pair.close)}${value.slice(pair.close + 1)}`;
  const nextCaret = position === pair.close ? pair.close - 1 : pair.open;
  return {
    value: next,
    caret: nextCaret,
    pairs: pairs.filter(candidate => candidate !== pair).map(candidate => ({
      ...candidate,
      open: candidate.open > pair.close ? candidate.open - 2 : candidate.open > pair.open ? candidate.open - 1 : candidate.open,
      close: candidate.close > pair.close ? candidate.close - 2 : candidate.close > pair.open ? candidate.close - 1 : candidate.close,
    })),
  };
}

// Controlled inputs report ordinary native edits after they happen. Preserve
// only pairs whose delimiters were not part of that edit, shifting positions as
// text is added or removed around them.
export function reconcileDelimiterPairs(previous: string, next: string, pairs: DelimiterPair[]) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) { previousEnd--; nextEnd--; }
  const delta = nextEnd - start - (previousEnd - start);
  const map = (position: number) => position < start ? position : position >= previousEnd ? position + delta : null;
  return pairs.flatMap((pair) => {
    const open = map(pair.open);
    const close = map(pair.close);
    return open === null || close === null ? [] : [{ ...pair, open, close }];
  });
}
