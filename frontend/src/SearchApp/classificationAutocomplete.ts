import { getMetadataTypeModifier, hasMetadataTypeToken, isChemicalNameList } from "../shared/metadataType";
import { searchLiteral } from "./compareQueries";

export const classificationColumn = "__classification_name";
export type SearchColumn = { column: string; type: string; name?: string; show_name?: string };
export type ClassificationCondition = { column: string; type: string; value: string };

export function classificationRanks(columns: SearchColumn[]): SearchColumn[][] {
  if (columns.some(c => c.column === classificationColumn)) return [];
  const tags = new Map<string, SearchColumn[][]>();
  for (const column of columns) {
    if (!hasMetadataTypeToken(column.type, "search")) continue;
    const args = getMetadataTypeModifier(column.type, "clas");
    if (!args || !/^\d+$/.test(args[0]) || Number(args[0]) > 1) continue;
    const ranks = tags.get(args[1] ?? "") ?? [[], []];
    ranks[Number(args[0])].push(column);
    tags.set(args[1] ?? "", ranks);
  }
  return [...tags.values()].filter(ranks => ranks.every(rank => rank.length === 1))
    .map(ranks => ranks.map(rank => rank[0]));
}

export function withClassificationColumn(columns: SearchColumn[]): SearchColumn[] {
  return classificationRanks(columns).length
    ? [...columns, { column: classificationColumn, show_name: "genus + species", type: "search specie" }]
    : columns;
}

export function valueCondition(column: SearchColumn, value: string): string {
  const operator = hasMetadataTypeToken(column.type, "set") || isChemicalNameList(column.column, column.type) ? "CONTAINS" : "=";
  return `${column.column} ${operator} ${searchLiteral(value)}`;
}

export function classificationSelection(conditions: ClassificationCondition[] | undefined, columns: SearchColumn[]): string {
  const ranks = classificationRanks(columns.filter(c => c.column !== classificationColumn));
  if (conditions?.length !== 2) return "";
  const pair = ranks.find(pair => conditions.every(condition => pair.some(c => c.column === condition.column)));
  if (!pair || !conditions.some(condition => condition.column === pair[1].column)) return "";
  const used = new Set<string>();
  const expressions: string[] = [];
  for (const condition of conditions) {
    const column = pair.find(c => c.column === condition.column);
    if (!column || used.has(column.column) || typeof condition.value !== "string" || !condition.value.trim()) return "";
    used.add(column.column);
    expressions.push(valueCondition(column, condition.value));
  }
  return `(${expressions.join(" AND ")})`;
}

// Typed searches use the existing physical columns; the virtual name never
// enters the public query grammar.
export function classificationTyped(value: string, columns: SearchColumn[]): string {
  const pairs = classificationRanks(columns.filter(c => c.column !== classificationColumn));
  const expressions = pairs.map(([species, genus]) => {
    const expressions = [valueCondition(genus, value), valueCondition(species, value)];
    const boundary = value.search(/\s/);
    if (boundary > 0) {
      expressions.push(`(${valueCondition(genus, value.slice(0, boundary))} AND ${valueCondition(species, value.slice(boundary).trim())})`);
    }
    return `(${expressions.join(" OR ")})`;
  }).join(" OR ");
  return expressions ? `(${expressions})` : "";
}
