import config from "../config";

const CMP_PARAM = "cmp";

export type CompareQuery = {
  query: string;
  color: string;
};

export function parseCompareQueries(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q) => (typeof q === "string" ? q.trim() : ""))
      .filter((q) => q !== "");
  } catch {
    return [];
  }
}

export function serializeCompareQueries(queries: string[]): string | null {
  const cleaned = queries.map((q) => q.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

export function readCompareQueriesFromParams(
  searchParams: URLSearchParams,
): string[] {
  return parseCompareQueries(searchParams.get(CMP_PARAM)).slice(
    0,
    Math.max(0, config["MAX_COMPARE_QUERIES"] - 1),
  );
}

export function writeCompareQueriesToParams(
  prev: URLSearchParams,
  queries: string[],
): URLSearchParams {
  const next = new URLSearchParams(prev);
  const serialized = serializeCompareQueries(
    queries.slice(0, Math.max(0, config["MAX_COMPARE_QUERIES"] - 1)),
  );
  if (serialized == null) next.delete(CMP_PARAM);
  else next.set(CMP_PARAM, serialized);
  return next;
}

/** Pick a random palette color not already used in `used`. */
export function allocateCompareColor(used: Iterable<string>): string {
  const palette = config["COMPARE_QUERY_COLORS"] as string[];
  const usedSet = new Set(used);
  const available = palette.filter((c) => !usedSet.has(c));
  const pool = available.length > 0 ? available : palette;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Ensure every query in `queries` has a color; drop colors for removed queries.
 * New queries get a random unused palette color.
 *
 * When `prevOrdered` is provided and has the same length as `queries`, colors are
 * carried over by index (so appending the same clade filter to every query keeps
 * the palette stable even though the query strings change).
 */
export function syncCompareColors(
  queries: string[],
  prev: Record<string, string>,
  prevOrdered?: string[],
): Record<string, string> {
  const seeded: Record<string, string> = {};
  const used = new Set<string>();

  if (prevOrdered && prevOrdered.length === queries.length) {
    queries.forEach((q, i) => {
      const color = prev[prevOrdered[i]];
      if (color && !used.has(color)) {
        seeded[q] = color;
        used.add(color);
      }
    });
  }

  const next: Record<string, string> = { ...seeded };
  queries.forEach((q) => {
    if (next[q]) return;
    if (prev[q] && !used.has(prev[q])) {
      next[q] = prev[q];
      used.add(prev[q]);
    }
  });
  queries.forEach((q) => {
    if (!next[q]) {
      const color = allocateCompareColor(used);
      next[q] = color;
      used.add(color);
    }
  });
  return next;
}

/** Append `key = 'val'` to a search query unless that key is already constrained. */
export function appendCladeClause(
  query: string,
  cladeKey: string,
  cladeVal: string,
): string {
  const clause = `${cladeKey} = '${cladeVal}'`;
  if (query.includes(clause) || query.includes(`${cladeKey} =`)) {
    return query;
  }
  const trimmed = query.trim();
  return trimmed === "" ? clause : `${trimmed} AND ${clause}`;
}

export { CMP_PARAM };
