/**
 * Detect likely metadata/search schema mismatches (e.g. after a DB version
 * bump while old responses are still in the client cache).
 */

export type SchemaSuspicion = {
  message: string;
  detail?: string;
};

type Listener = (issue: SchemaSuspicion | null) => void;

const listeners = new Set<Listener>();
let current: SchemaSuspicion | null = null;

export function subscribeSchemaSuspicion(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function getSchemaSuspicion(): SchemaSuspicion | null {
  return current;
}

export function clearSchemaSuspicion(): void {
  if (current == null) return;
  current = null;
  listeners.forEach((l) => l(null));
}

export function reportSchemaSuspicion(issue: SchemaSuspicion): void {
  // Keep the first open issue until cleared (avoid flicker from many checks).
  if (current != null) return;
  current = issue;
  listeners.forEach((l) => l(current));
}

function metaColumns(
  metadata: Array<{ column?: unknown; type?: unknown }>,
): string[] {
  return metadata
    .map((m) => (typeof m.column === "string" ? m.column.trim() : ""))
    .filter(Boolean);
}

/** Stable fingerprint of metadata column+type pairs. */
export function metadataFingerprint(metadata: unknown): string {
  if (!Array.isArray(metadata)) return "";
  return metadata
    .map((m) => {
      if (!m || typeof m !== "object") return "";
      const col = String((m as { column?: unknown }).column ?? "").trim();
      const typ = String((m as { type?: unknown }).type ?? "").trim();
      if (!col) return "";
      return `${col}\t${typ}`;
    })
    .filter(Boolean)
    .sort()
    .join("\n");
}

/**
 * Inspect a /search payload. Returns a suspicion message or null if OK.
 */
export function inspectSearchPayload(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") {
    return "Search response has an unexpected shape.";
  }
  const body = payload as { metadata?: unknown; data?: unknown };
  const meta = body.metadata;
  const data = body.data;

  const hasRows = Array.isArray(data) && data.length > 0;
  if (!Array.isArray(meta)) {
    return hasRows
      ? "Search returned data without a metadata list — the API format may have changed."
      : "Search metadata is missing or invalid.";
  }

  if (meta.length === 0 && hasRows) {
    return "Search returned rows but metadata is empty — cached responses may be out of date.";
  }

  for (const item of meta) {
    if (!item || typeof item !== "object") {
      return "Metadata entries look malformed.";
    }
    const m = item as { column?: unknown; type?: unknown };
    if (typeof m.column !== "string" || m.column.trim() === "") {
      return "A metadata entry is missing its column name.";
    }
    if (typeof m.type !== "string") {
      return "A metadata entry is missing its type.";
    }
  }

  if (!hasRows) return null;

  const cols = metaColumns(meta as Array<{ column?: unknown }>);
  if (cols.length === 0) return null;

  const sample = (data as Array<Record<string, unknown>>).slice(0, 25);
  let present = 0;
  let checked = 0;
  for (const row of sample) {
    if (!row || typeof row !== "object") continue;
    for (const col of cols) {
      checked += 1;
      if (Object.prototype.hasOwnProperty.call(row, col)) present += 1;
    }
  }

  if (checked > 0 && present / checked < 0.55) {
    return "Search row fields do not match the embedded metadata — this often happens after a data update if an old response is still cached.";
  }

  // clas / default[] references should point at known columns
  const colSet = new Set(cols);
  for (const item of meta as Array<{ type?: string; column?: string }>) {
    const t = item.type ?? "";
    if (t.includes("default[")) {
      const def = t.split("default[")[1]?.split("]")[0];
      if (def && !colSet.has(def) && !colSet.has(item.column ?? "")) {
        // soft: only flag if many such misses — skip for single
      }
    }
  }

  return null;
}

/** Flag when several compare payloads disagree on metadata schema. */
export function inspectComparePayloads(
  payloads: unknown[],
): string | null {
  const fps = payloads
    .map((p) =>
      metadataFingerprint(
        p && typeof p === "object"
          ? (p as { metadata?: unknown }).metadata
          : null,
      ),
    )
    .filter(Boolean);
  if (fps.length < 2) return null;
  const unique = new Set(fps);
  if (unique.size > 1) {
    return "Compared queries use different metadata schemas — some results may be from an older cached version.";
  }
  return null;
}

const CACHE_HINT =
  "Try clearing the API cache, then reload this page.";

/** Last successful /metadata fingerprint + table timestamp (session-wide). */
let catalogFingerprint = "";
let catalogTimestamp = "";
/** Last inspected /search fingerprint + timestamp (for late catalog compare). */
let lastSearchFingerprint = "";
let lastSearchTimestamp = "";

function payloadTimestamp(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const ts = (payload as { timestamp?: unknown }).timestamp;
  if (ts == null) return "";
  return String(ts);
}

function compareCatalogAgainstSearch(): void {
  if (catalogTimestamp && lastSearchTimestamp && catalogTimestamp !== lastSearchTimestamp) {
    reportSchemaSuspicion({
      message:
        "Search results are from a different data version than the search form — cached responses may be out of date after an update.",
      detail: CACHE_HINT,
    });
    return;
  }

  if (
    catalogFingerprint &&
    lastSearchFingerprint &&
    catalogFingerprint !== lastSearchFingerprint
  ) {
    reportSchemaSuspicion({
      message:
        "Search results use a different metadata schema than the search form — cached /metadata and /search responses may be out of sync after an update.",
      detail: CACHE_HINT,
    });
  }
}

/**
 * Validate the standalone /metadata catalog and remember its fingerprint
 * so later /search responses can be checked against it.
 */
export function guardMetadataCatalog(
  metadata: unknown,
  responseBody?: unknown,
): void {
  if (!Array.isArray(metadata)) {
    reportSchemaSuspicion({
      message: "Metadata catalog has an unexpected shape.",
      detail: CACHE_HINT,
    });
    return;
  }
  for (const item of metadata) {
    if (!item || typeof item !== "object") {
      reportSchemaSuspicion({
        message: "Metadata catalog entries look malformed.",
        detail: CACHE_HINT,
      });
      return;
    }
    const m = item as { column?: unknown; type?: unknown };
    if (typeof m.column !== "string" || m.column.trim() === "") {
      reportSchemaSuspicion({
        message: "A metadata catalog entry is missing its column name.",
        detail: CACHE_HINT,
      });
      return;
    }
    if (typeof m.type !== "string") {
      reportSchemaSuspicion({
        message: "A metadata catalog entry is missing its type.",
        detail: CACHE_HINT,
      });
      return;
    }
  }
  const fp = metadataFingerprint(metadata);
  if (fp) catalogFingerprint = fp;
  const ts = payloadTimestamp(responseBody);
  if (ts) catalogTimestamp = ts;
  compareCatalogAgainstSearch();
}

/** Run checks and publish a banner if something looks wrong. */
export function guardSearchPayload(payload: unknown): void {
  const msg = inspectSearchPayload(payload);
  if (msg) {
    reportSchemaSuspicion({ message: msg, detail: CACHE_HINT });
    return;
  }

  const body = payload as { metadata?: unknown };
  const searchFp = metadataFingerprint(body?.metadata);
  const searchTs = payloadTimestamp(payload);
  if (searchFp) lastSearchFingerprint = searchFp;
  if (searchTs) lastSearchTimestamp = searchTs;
  compareCatalogAgainstSearch();
}

export function guardComparePayloads(payloads: unknown[]): void {
  const msg = inspectComparePayloads(payloads);
  if (msg) {
    reportSchemaSuspicion({ message: msg, detail: CACHE_HINT });
  }
}
