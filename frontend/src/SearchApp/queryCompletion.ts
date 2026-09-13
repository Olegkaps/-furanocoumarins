import { getMetadataTypeModifier, hasMetadataTypeToken } from "../shared/metadataType";

export const COMPLETION_LIMIT = 12;
const textOperators = ["=", "!=", "<", ">", "<=", ">=", "LIKE"];
export type QueryColumn = { column: string; name: string; set: boolean; choices: string[] };
export type CompletionContext = {
  kind: "column" | "operator" | "value" | "logical" | "invalid";
  start: number; end: number; prefix: string; depth: number; column?: QueryColumn;
};
export type QuerySuggestion = { label: string; insert: string; detail?: string };

export function queryColumns(metadata: unknown): QueryColumn[] {
  if (!Array.isArray(metadata)) return [];
  const seen = new Set<string>();
  return metadata.flatMap((m) => {
    if (!m || typeof m.column !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(m.column) ||
      typeof m.type !== "string" || seen.has(m.column)) return [];
    seen.add(m.column);
    return [{ column: m.column, name: typeof m.name === "string" ? m.name : m.column,
      set: hasMetadataTypeToken(m.type, "set"),
      choices: getMetadataTypeModifier(m.type, "set")?.[0].split(/\s+/).filter(Boolean) ?? [] }];
  });
}

export function queryContext(query: string, caret: number, columns: QueryColumn[]): CompletionContext {
  caret = Math.max(0, Math.min(query.length, caret));
  // Quoted strings are single tokens, including doubled apostrophes and unfinished literals.
  const tokens = [...query.matchAll(/'(?:[^']|'')*'?|[A-Za-z_][A-Za-z0-9_]*|!=|<=|>=|[=<>]|[()]|[^\s]/g)];
  const active = tokens.find((t) => t.index === caret) ?? tokens.find((t) => t.index < caret && caret <= t.index + t[0].length &&
    !(caret === t.index + t[0].length && (t[0] === "(" || t[0] === ")" || /^'(?:[^']|'')*'$/.test(t[0]))));
  const start = active?.index ?? caret;
  let kind: CompletionContext["kind"] = "column";
  let column: QueryColumn | undefined;
  let depth = 0;
  for (const token of tokens) {
    if (token.index >= start) break;
    const value = token[0];
    if (kind === "column") {
      if (value === "(") { depth++; continue; }
      column = columns.find((c) => c.column === value);
      kind = column ? "operator" : "invalid";
    } else if (kind === "operator") {
      kind = (column?.set ? ["CONTAINS"] : textOperators).includes(value) ? "value" : "invalid";
    } else if (kind === "value") {
      kind = /^'(?:[^']|'')*'$/.test(value) ? "logical" : "invalid";
    } else if (kind === "logical") {
      if (value === ")" && depth > 0) depth--;
      else if (["AND", "OR"].includes(value)) { kind = "column"; column = undefined; }
      else kind = "invalid";
    }
  }
  let prefix = query.slice(start, caret);
  if (kind === "value" && prefix.startsWith("'")) prefix = prefix.slice(1).replace(/''/g, "'");
  return { kind, start, end: active ? active.index + active[0].length : caret, prefix, depth, column };
}

export function querySuggestions(context: CompletionContext, columns: QueryColumn[], values: unknown = []): QuerySuggestion[] {
  const { kind, column, prefix, depth } = context;
  let suggestions: QuerySuggestion[] = [];
  if (kind === "column") suggestions = [{ label: "(", insert: "(" }, ...columns.map((c) => ({ label: c.column, insert: c.column, detail: c.name }))];
  if (kind === "operator") suggestions = (column?.set ? ["CONTAINS"] : textOperators).map((label) => ({ label, insert: label }));
  if (kind === "logical") suggestions = ["AND", "OR", ...(depth > 0 ? [")"] : [])].map((label) => ({ label, insert: label }));
  if (kind === "value") {
    const candidates = column?.choices.length ? column.choices : values;
    if (!Array.isArray(candidates)) return [];
    const seen = new Set<string>();
    for (const value of candidates) {
      if (typeof value !== "string" || seen.has(value) || !value.toLowerCase().includes(prefix.toLowerCase())) continue;
      seen.add(value);
      suggestions.push({ label: value, insert: `'${value.replace(/'/g, "''")}'` });
      if (suggestions.length === COMPLETION_LIMIT) break;
    }
    return suggestions;
  }
  return suggestions.filter((s) => s.label.toLowerCase().startsWith(prefix.toLowerCase()) || s.detail?.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, COMPLETION_LIMIT);
}

export function applyQuerySuggestion(query: string, context: CompletionContext, suggestion: QuerySuggestion) {
  const before = query.slice(0, context.start);
  const preserveNextToken = context.kind === "operator" && /^[()']/.test(query.slice(context.start, context.end));
  const after = query.slice(preserveNextToken ? context.start : context.end);
  const leading = before && !/[\s(]$/.test(before) ? " " : "";
  const trailing = /^\s/.test(after) ? "" : " ";
  if (context.kind === "operator") {
    const operator = before + leading + suggestion.insert;
    if (after.trimStart().startsWith("'")) {
      return { value: operator + trailing + after, caret: operator.length + trailing.length + after.indexOf("'") + 1 };
    }
    return { value: operator + " ''" + trailing + after, caret: operator.length + 2 };
  }
  const replacement = leading + suggestion.insert + trailing;
  return { value: before + replacement + after, caret: before.length + replacement.length };
}

export function queryValueRequestKey(context: CompletionContext) {
  return context.kind === "value" && context.prefix.trim().length > 0 && context.column && !context.column.choices.length
    ? JSON.stringify([context.column.column, context.prefix]) : "";
}

/** Cleanup cancels both the debounce and transport, even if the transport ignores abort. */
export function scheduleQueryValues(load: (signal: AbortSignal) => Promise<unknown>, receive: (values: unknown) => void, delay = 250) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return [];
      return load(controller.signal);
    }).then((values) => { if (!controller.signal.aborted) receive(values); })
      .catch(() => { if (!controller.signal.aborted) receive([]); });
  }, delay);
  return () => { clearTimeout(timer); controller.abort(); };
}

export function completionKey(key: string, active: number, count: number) {
  if (!count) return { active, choose: false, handled: false };
  if (key === "ArrowDown") return { active: (active + 1) % count, choose: false, handled: true };
  if (key === "ArrowUp") return { active: active < 0 ? count - 1 : (active + count - 1) % count, choose: false, handled: true };
  return { active, choose: key === "Enter" && active >= 0, handled: key === "Enter" && active >= 0 };
}
