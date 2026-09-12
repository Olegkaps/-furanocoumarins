import { getMetadataTypeModifier } from "../shared/metadataType.mjs";

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
