import { getMetadataTypeModifier } from "../shared/metadataType.mjs";

/** Empty taxonomy ranks are one unnamed node, regardless of their API marker. */
export function normalizeTreeClade(value) {
  const text = value == null ? "" : String(value);
  return text.trim() === "" || text.trim() === "NoValue" ? "" : text;
}

/** Match the renderer's taxonomy-path union, stopping once a tree is possible. */
export function canShowPhylogeneticTree(response, compareSeries = [], tag = "original") {
  const { columns } = selectTreeTaxonomy(response.metadata ?? [], tag);
  const responses = compareSeries.length > 1
    ? compareSeries.map(series => series.response)
    : [response];
  let firstPath;
  for (const current of responses) {
    for (const row of current.data ?? []) {
      const path = columns.map(column => normalizeTreeClade(row[column.column])).join("@");
      if (firstPath === undefined) firstPath = path;
      else if (path !== firstPath) return true;
    }
  }
  return false;
}

/** One column per rank, broadest first; selected taxonomy overrides original. */
export function selectTreeTaxonomy(metadata, tag = "original") {
  const tags = new Set(["original", tag]);
  const ranks = new Map();
  for (const column of metadata) {
    const classification = getMetadataTypeModifier(column.type, "clas");
    if (!classification || !/^\d+$/.test(classification[0])) continue;
    const level = Number(classification[0]);
    if (!Number.isSafeInteger(level)) continue;
    const source = classification[1] ?? "original";
    tags.add(source);
    if (source !== "original" && source !== tag) continue;
    const previous = ranks.get(level);
    if (!previous || (source === tag && previous.source !== tag)) {
      ranks.set(level, { column, source });
    }
  }
  return {
    columns: [...ranks].sort(([a], [b]) => b - a).map(([, rank]) => rank.column),
    tags: [...tags].sort(),
  };
}
