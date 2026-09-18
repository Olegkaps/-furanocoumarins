import DataMeta from "./DataMeta";
import { getMetadataTypeModifier, hasMetadataTypeToken } from "../shared/metadataType";

type Metadata = { column: string; name: string; description: string; type: string };
type SearchResponse = { metadata: Metadata[]; data: Array<Record<string, unknown>> };

function detailMeta(item: Metadata): DataMeta {
  const type = item.type;
  const link = getMetadataTypeModifier(type, "link");
  const classification = getMetadataTypeModifier(type, "clas");
  const classificationLevel = classification && /^\d+$/.test(classification[0]) ? Number(classification[0]) : null;
  const rendered = link ? "link" : classification ? "clas" : hasMetadataTypeToken(type, "SMILES") ? "smiles" : hasMetadataTypeToken(type, "ref[]") ? "reference" : "";
  return new DataMeta(rendered, item.column, item.name, item.description, link?.[0] ?? "", hasMetadataTypeToken(type, "chemical") ? "chemical" : hasMetadataTypeToken(type, "specie") || classification ? "specie" : "ignore", {
    isListName: hasMetadataTypeToken(type, "list_name"), classificationLevel,
    showOnChemicalPage: hasMetadataTypeToken(type, "chemical_page"),
    showOnSpeciesPage: hasMetadataTypeToken(type, "species_page"),
  });
}

export function entityPageColumns(metadata: Metadata[], kind: "chemical" | "species"): DataMeta[] {
  return metadata.map(detailMeta).filter(column => kind === "chemical" ? column.show_on_chemical_page : column.show_on_species_page).slice(0, 7);
}

export function rowFromEntitySearch(response: SearchResponse): Map<string, string> | null {
  const row = response.data[0];
  if (!row || response.data.length !== 1) return null;
  return new Map(Object.entries(row).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
}

export function escapedQueryValue(value: string): string { return value.replaceAll("'", "''"); }

export function entityCondition(column: Metadata, value: string): string {
  return `${column.column}${hasMetadataTypeToken(column.type, "set") ? " CONTAINS " : " = "}'${escapedQueryValue(value)}'`;
}
