import DataMeta from "./DataMeta";
import { getMetadataTypeModifier, hasMetadataTypeToken } from "../shared/metadataType";

export type Metadata = { column: string; name: string; description: string; type: string };
export type MetadataResponse = { metadata: Metadata[]; timestamp: string };
export type SearchResponse = { metadata: Metadata[]; data: Array<Record<string, unknown>>; timestamp: string };
const entityPageFieldLimit = 7;

type SpeciesFallback = { target: string; sources: string[] };

export function detailMeta(item: Metadata): DataMeta {
  const type = item.type;
  const link = getMetadataTypeModifier(type, "link");
  const classification = getMetadataTypeModifier(type, "clas");
  const classificationLevel = classification && /^\d+$/.test(classification[0]) ? Number(classification[0]) : null;
  const classificationTag = !classification ? null : classification[1] === undefined || classification[1] === "default" || classification[1] === "original" ? "original" : classification[1];
  const rendered = link ? "link" : classification ? "clas" : hasMetadataTypeToken(type, "SMILES") ? "smiles" : hasMetadataTypeToken(type, "ref[]") ? "reference" : "";
  return new DataMeta(rendered, item.column, item.name, item.description, link?.[0] ?? "", hasMetadataTypeToken(type, "chemical") ? "chemical" : hasMetadataTypeToken(type, "specie") || classification ? "specie" : "ignore", {
    isListName: hasMetadataTypeToken(type, "list_name"), classificationLevel, classificationTag,
    showOnChemicalPage: hasMetadataTypeToken(type, "chemical_page"),
    showOnSpeciesPage: hasMetadataTypeToken(type, "species_page"),
  });
}

export function entityPageColumns(metadata: Metadata[], kind: "chemical" | "species"): DataMeta[] {
  const columns = metadata.map(detailMeta).filter(column => kind === "chemical" ? column.show_on_chemical_page : column.show_on_species_page);
  return sortEntityColumns(kind, columns);
}

function sortEntityColumns(kind: "chemical" | "species", columns: DataMeta[]): DataMeta[] {
  if (kind !== "species") return columns;
  return columns.sort((left, right) => {
    const leftRank = left.classification_level;
    const rightRank = right.classification_level;
    if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return rightRank - leftRank;
    if (leftRank !== null && rightRank === null) return -1;
    if (leftRank === null && rightRank !== null) return 1;
    return 0;
  });
}

export type SourceEntityRecord = { kind: "chemicals" | "species"; columns: Metadata[]; item: Record<string, unknown> };

// Catalog-only records have no joined observation. Show configured page fields
// plus the source identity/search fields so the page remains useful even when
// a legacy definition did not mark its title or identifier for that page.
export function sourceEntityPageDetails(record: SourceEntityRecord, kind: "chemical" | "species"): { meta: DataMeta[]; row: Map<string, string> } | null {
  const meta = sortEntityColumns(kind, record.columns
    .filter(column => !hasMetadataTypeToken(column.type, "invisible"))
    .filter(column => {
      const pageField = kind === "chemical" ? hasMetadataTypeToken(column.type, "chemical_page") : hasMetadataTypeToken(column.type, "species_page");
      return pageField || hasMetadataTypeToken(column.type, "primary") || hasMetadataTypeToken(column.type, "search");
    })
    .map(detailMeta));
  const row = new Map(Object.entries(record.item).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
  return meta.some(column => {
    const value = row.get(column.name) ?? "";
    return value.trim() !== "" && value.replaceAll(" ", "") !== "NoValue";
  }) ? { meta, row } : null;
}

function isDefaultClassification(item: Metadata): boolean {
  const classification = getMetadataTypeModifier(item.type, "clas");
  return Boolean(classification && (classification[1] === undefined || classification[1] === "default" || classification[1] === "original"));
}

function speciesPageFallbacks(metadata: Metadata[], displayed: DataMeta[]): SpeciesFallback[] {
  const known = new Set(metadata.map(item => item.column));
  return displayed.flatMap(column => {
    const sourceNames: string[] = [];
    const item = metadata.find(candidate => candidate.column === column.name);
    if (!item) return [];
    const explicitDefault = getMetadataTypeModifier(item.type, "default")?.[0];
    if (explicitDefault && known.has(explicitDefault)) sourceNames.push(explicitDefault);
    const classification = getMetadataTypeModifier(item.type, "clas");
    const level = classification?.[0];
    if (level && !isDefaultClassification(item)) {
      const defaults = metadata.filter(candidate => {
        const candidateClassification = getMetadataTypeModifier(candidate.type, "clas");
        return candidate.column !== column.name && candidateClassification?.[0] === level && isDefaultClassification(candidate);
      });
      if (defaults.length === 1) sourceNames.push(defaults[0].column);
    }
    return sourceNames.length ? [{ target: column.name, sources: [...new Set(sourceNames)] }] : [];
  });
}

function entityPagePlan(metadata: Metadata[], kind: "chemical" | "species") {
  const meta = entityPageColumns(metadata, kind);
  const fallbacks = kind === "species" ? speciesPageFallbacks(metadata, meta) : [];
  const supportColumns = [...new Set(fallbacks.flatMap(fallback => fallback.sources))]
    .filter(name => !meta.some(column => column.name === name));
  return { meta, fallbacks, supportColumns };
}

// The search endpoint accepts at most eight projected columns. Every request
// includes the query identity, leaving seven detail fields per bounded chunk.
export function entityPageProjectionChunks(columns: DataMeta[], identityColumn: string, supportColumns: string[] = []): string[][] {
  const detailColumns = [...new Set([...columns.map(column => column.name), ...supportColumns])].filter(name => name !== identityColumn);
  if (detailColumns.length === 0) return [[identityColumn]];
  const chunks: string[][] = [];
  for (let index = 0; index < detailColumns.length; index += entityPageFieldLimit) {
    chunks.push([identityColumn, ...detailColumns.slice(index, index + entityPageFieldLimit)]);
  }
  return chunks;
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function isNoValue(value: string): boolean {
  return value.replaceAll(" ", "") === "NoValue";
}

function applySpeciesFallbacks(row: Map<string, string>, fallbacks: SpeciesFallback[]): void {
  for (const { target, sources } of fallbacks) {
    const current = row.get(target) ?? "";
    if (!isBlank(current) && !isNoValue(current)) continue;
    const fallback = sources.map(source => row.get(source) ?? "").find(value => !isBlank(value) && !isNoValue(value));
    row.set(target, fallback ?? "");
  }
}

// Search projects joined observations, so an entity can legitimately have more
// than one projected row. Keep a field only when the rows agree, treating
// missing and blank values as absent rather than as a conflict.
export function rowFromEntitySearch(response: SearchResponse, identityColumn: string): Map<string, string> | null {
  const merged = new Map<string, string>();
  let identity: string | undefined;
  for (const source of response.data) {
    const row = new Map(Object.entries(source).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
    const nextIdentity = row.get(identityColumn);
    if (nextIdentity === undefined || (identity !== undefined && identity !== nextIdentity)) return null;
    identity = nextIdentity;
    for (const [key, value] of row) {
      const existing = merged.get(key);
      if (existing === undefined || isBlank(existing)) {
        merged.set(key, value);
      } else if (!isBlank(value) && existing !== value) {
        return null;
      }
    }
  }
  return identity === undefined ? null : merged;
}

// Refuse a partial or changing projection: all chunks must resolve one record
// with the same identity before detail values are displayed.
export function mergeEntityPageRows(responses: SearchResponse[], identityColumn: string, expectedTimestamp: string): Map<string, string> | null {
  const merged = new Map<string, string>();
  let identity: string | undefined;
  for (const response of responses) {
    if (response.timestamp !== expectedTimestamp) return null;
    const row = rowFromEntitySearch(response, identityColumn);
    const nextIdentity = row?.get(identityColumn);
    if (!row || nextIdentity === undefined || (identity !== undefined && identity !== nextIdentity)) return null;
    identity = nextIdentity;
    for (const [key, value] of row) {
      const existing = merged.get(key);
      if (existing !== undefined && existing !== value) return null;
      merged.set(key, value);
    }
  }
  return identity === undefined ? null : merged;
}

type SearchChunk = (params: { q: string; columns: string; limit: number }, signal: AbortSignal) => Promise<SearchResponse>;
export async function fetchEntityPageDetails(metadataResponse: MetadataResponse, kind: "chemical" | "species", identityColumn: string, identityValue: string, signal: AbortSignal, fetchChunk: SearchChunk): Promise<{ meta: DataMeta[]; row: Map<string, string> } | null> {
  const { meta, fallbacks, supportColumns } = entityPagePlan(metadataResponse.metadata, kind);
  const identityMeta = metadataResponse.metadata.find(column => column.column === identityColumn);
  if (!identityMeta || meta.length === 0) return null;
  const responses: SearchResponse[] = [];
  for (const columns of entityPageProjectionChunks(meta, identityColumn, supportColumns)) {
    if (signal.aborted) return null;
    const response = await fetchChunk({ q: entityCondition(identityMeta, identityValue), columns: columns.join(","), limit: 2 }, signal);
    if (signal.aborted) return null;
    responses.push(response);
  }
  const row = mergeEntityPageRows(responses, identityColumn, metadataResponse.timestamp);
  if (row && kind === "species") applySpeciesFallbacks(row, fallbacks);
  return row ? { meta, row } : null;
}

export function escapedQueryValue(value: string): string { return value.replaceAll("'", "''"); }

export function entityCondition(column: Metadata, value: string): string {
  return `${column.column}${hasMetadataTypeToken(column.type, "set") ? " CONTAINS " : " = "}'${escapedQueryValue(value)}'`;
}
