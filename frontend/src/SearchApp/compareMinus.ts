import {
  getMetadataTypeModifier,
  hasMetadataTypeToken,
} from "../shared/metadataType";
import { resultRowIdentity } from "./resultRowIdentity";

type SearchResponse = { [index: string]: any };
type MetadataRow = { [index: string]: any };
type DataRow = { [index: string]: any };
type CompareSeriesLike = {
  mode: "plus" | "minus";
  query: string;
  response: SearchResponse;
};
type IdentityPlan = {
  chemicalKeyColumn: string;
  speciesKeyColumn: string;
  valueColumns: string[];
  refColumns: string[];
};

function isSpeciesColumn(columnType: string): boolean {
  return (
    hasMetadataTypeToken(columnType, "specie") ||
    Boolean(getMetadataTypeModifier(columnType, "clas"))
  );
}

function isChemicalColumn(columnType: string): boolean {
  return (
    hasMetadataTypeToken(columnType, "chemical") ||
    hasMetadataTypeToken(columnType, "SMILES")
  );
}

function buildIdentityPlan(metadata: MetadataRow[]): IdentityPlan {
  let chemicalKeyColumn = "";
  let speciesKeyColumn = "";
  const valueColumns: string[] = [];
  const refColumns: string[] = [];

  metadata.forEach((meta) => {
    const column = String(meta["column"] ?? "");
    const columnType = String(meta["type"] ?? "");
    if (hasMetadataTypeToken(columnType, "chemical")) {
      if (hasMetadataTypeToken(columnType, "keycolumn")) {
        chemicalKeyColumn = column;
      }
      return;
    }
    if (hasMetadataTypeToken(columnType, "specie")) {
      if (hasMetadataTypeToken(columnType, "keycolumn")) {
        speciesKeyColumn = column;
      }
      return;
    }
    if (isChemicalColumn(columnType) || isSpeciesColumn(columnType)) {
      return;
    }
    if (hasMetadataTypeToken(columnType, "ref[]")) {
      refColumns.push(column);
    }
    valueColumns.push(column);
  });

  return { chemicalKeyColumn, speciesKeyColumn, valueColumns, refColumns };
}

function rowIdentityFromPlan(row: DataRow, plan: IdentityPlan): string {
  const valueRow = new Map<string, string>();
  plan.valueColumns.forEach((column) => {
    valueRow.set(column, row[column] != null ? String(row[column]) : "");
  });

  return resultRowIdentity(
    plan.speciesKeyColumn ? row[plan.speciesKeyColumn] : "",
    plan.chemicalKeyColumn ? row[plan.chemicalKeyColumn] : "",
    valueRow,
    plan.refColumns,
  );
}

function dataRows(response: SearchResponse): DataRow[] {
  return Array.isArray(response["data"]) ? (response["data"] as DataRow[]) : [];
}

function metadataRows(response: SearchResponse): MetadataRow[] {
  return Array.isArray(response["metadata"])
    ? (response["metadata"] as MetadataRow[])
    : [];
}

function buildMinusKeySet(
  plan: IdentityPlan,
  minusResponses: SearchResponse[],
): Set<string> {
  const minusKeys = new Set<string>();
  minusResponses.forEach((response) => {
    dataRows(response).forEach((row) => {
      minusKeys.add(rowIdentityFromPlan(row, plan));
    });
  });
  return minusKeys;
}

function subtractMinusKeys(
  plusResponse: SearchResponse,
  plan: IdentityPlan,
  minusKeys: Set<string>,
): SearchResponse {
  const data = dataRows(plusResponse);
  if (minusKeys.size === 0) return plusResponse;

  return {
    ...plusResponse,
    data: data.filter(
      (row) => !minusKeys.has(rowIdentityFromPlan(row, plan)),
    ),
  };
}

export function subtractMinusResponses(
  plusResponse: SearchResponse,
  minusResponses: SearchResponse[],
): SearchResponse {
  if (minusResponses.length === 0) return plusResponse;
  const metadata = metadataRows(plusResponse);
  const data = dataRows(plusResponse);
  if (metadata.length === 0 || data.length === 0) return plusResponse;
  const plan = buildIdentityPlan(metadata);
  return subtractMinusKeys(
    plusResponse,
    plan,
    buildMinusKeySet(plan, minusResponses),
  );
}

export function subtractMinusFromCompareSeries<T extends CompareSeriesLike>(
  series: T[],
  hiddenQueries: string[],
): { minusResponses: SearchResponse[]; plusSeries: T[] } {
  const minusResponses = series
    .filter((s) => s.mode === "minus")
    .map((s) => s.response);
  const visiblePlusSeries = series.filter(
    (s) => s.mode === "plus" && !hiddenQueries.includes(s.query),
  );
  if (minusResponses.length === 0 || visiblePlusSeries.length === 0) {
    return { minusResponses, plusSeries: visiblePlusSeries };
  }
  const metadata = metadataRows(visiblePlusSeries[0].response);
  if (metadata.length === 0) {
    return { minusResponses, plusSeries: visiblePlusSeries };
  }
  const plan = buildIdentityPlan(metadata);
  const minusKeys = buildMinusKeySet(plan, minusResponses);
  const plusSeries = visiblePlusSeries.map((s) => ({
    ...s,
    response: subtractMinusKeys(s.response, plan, minusKeys),
  }));
  return { minusResponses, plusSeries };
}
