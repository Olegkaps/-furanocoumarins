import config from "../config";

const LS_KEY = "fuco-query-history:v1";

export type QueryHistoryEntry = {
  /** Stable id for React keys. */
  id: string;
  /** ISO timestamp of the (last) successful fetch for this group. */
  at: string;
  /** Ordered queries: primary first, then compare extras. */
  queries: string[];
};

function retentionMs(): number {
  const ms = config["QUERY_HISTORY_RETENTION_MS"];
  return Number.isFinite(ms) && ms > 0 ? ms : 18 * 30 * 24 * 60 * 60 * 1000;
}

function groupKey(queries: string[]): string {
  return queries.join("\u0001");
}

function prune(entries: QueryHistoryEntry[], now = Date.now()): QueryHistoryEntry[] {
  const cutoff = now - retentionMs();
  return entries.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function readRaw(): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e): QueryHistoryEntry | null => {
        if (!e || typeof e !== "object") return null;
        const at = typeof e.at === "string" ? e.at : "";
        const id = typeof e.id === "string" ? e.id : "";
        const queries = Array.isArray(e.queries)
          ? e.queries
              .map((q: unknown) => (typeof q === "string" ? q.trim() : ""))
              .filter(Boolean)
          : [];
        if (!at || !id || queries.length === 0) return null;
        return { id, at, queries };
      })
      .filter((e): e is QueryHistoryEntry => e != null);
  } catch {
    return [];
  }
}

function writeRaw(entries: QueryHistoryEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* quota — drop oldest half and retry once */
    try {
      const half = entries.slice(0, Math.ceil(entries.length / 2));
      localStorage.setItem(LS_KEY, JSON.stringify(half));
    } catch {
      /* ignore */
    }
  }
}

/** Newest-first history within retention window. */
export function loadQueryHistory(): QueryHistoryEntry[] {
  const pruned = prune(readRaw());
  writeRaw(pruned);
  return pruned;
}

/**
 * Record (or refresh) a compare group after a successful search fetch.
 * Same ordered query list upserts to the top with a new timestamp.
 */
export function recordQueryHistory(
  queries: string[],
  at: string = new Date().toISOString(),
): void {
  const cleaned = queries.map((q) => q.trim()).filter(Boolean);
  if (cleaned.length === 0) return;

  const key = groupKey(cleaned);
  const prev = prune(readRaw());
  const existing = prev.find((e) => groupKey(e.queries) === key);
  const rest = prev.filter((e) => groupKey(e.queries) !== key);
  const entry: QueryHistoryEntry = {
    id: existing?.id ?? `${Date.now().toString(36)}-${key.length}`,
    at,
    queries: cleaned,
  };
  writeRaw([entry, ...rest]);
}

export function clearQueryHistory(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
