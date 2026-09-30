import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  FileArrowUp,
  Molecule,
  BranchesRight,
  BookOpen,
  Xmark,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowUpArrowDown,
  Funnel,
} from "@gravity-ui/icons";
import { isEmpty } from "../shared/api";
import { Container, ScrollableContainer } from "../shared/ui";
import config from "../config";
import DataMeta from "./DataMeta";
import { EntityDetailTable } from "./EntityDetailTable";
import DataRows from "./RowsData";
import { type CountMode } from "./PhylogeneticTree";
import { InfoTip } from "../shared/ui/InfoTip";
import { substancePagePath } from "../shared/substanceUrl";
import { taxonPath, type TaxonLink } from "../TaxonPage/taxonPage";
import { QueryCompareBar, type CompareSeries } from "./QueryCompareBar";
import { CitationPopover } from "../shared/ui/CitationPopover";
import { compareMetadataResultTypes, getMetadataTypeModifier, hasMetadataTypeToken } from "../shared/metadataType";
import { detailMeta, type Metadata } from "./entityPageDetails";
import { inspectComparePayloads } from "../shared/schemaGuard";
import { resultGroupIdentity, resultRowIdentity } from "./resultRowIdentity";
import * as XLSX from "xlsx";

function collectUniqueTokensFromRow(
  row: Map<string, string>,
  columnNames: string[],
  into: Set<string>,
) {
  columnNames.forEach((col) => {
    const v = row.get(col);
    if (v != null && String(v).trim() !== "") {
      String(v)
        .split(/\s*,\s*/)
        .forEach((s) => {
          const t = s.trim();
          if (t) into.add(t);
        });
    }
  });
}

function uniqueArticleCountInRows(
  rows: DataRows[],
  refColumns: string[],
): number {
  const merged = new Set<string>();
  rows.forEach((dr) => {
    dr.value_rows.forEach((row) =>
      collectUniqueTokensFromRow(row, refColumns, merged),
    );
  });
  return merged.size;
}

function isConfiguredCountValue(value: string): boolean {
  const normalized = value.replaceAll(" ", "").toLowerCase();
  return normalized !== "" && normalized !== "novalue";
}

type SelectOption = {
  value: string;
  label: string;
  count: number;
  seriesCounts?: Array<{ color: string; n: number }>;
};

type OptionAggregate = {
  value: string;
  label: string;
  total: number;
  counterparts: Set<string>;
  articles: Set<string>;
};

type EntityGroup = { primary_column: string; count_column: string; columns: Metadata[]; items: Array<Record<string, unknown>> };
type EntityGroups = { chemical?: EntityGroup; species?: EntityGroup };
type Grouping = {
  chemical: boolean;
  specie: boolean;
  chemicalOriginal?: boolean;
  representatives: { chemical: Map<string, Map<string, string>>; specie: Map<string, Map<string, string>> };
  metadata: { chemical: DataMeta[]; specie: DataMeta[] };
};

const rowValue = (value: unknown) => Array.isArray(value) ? value.join(", ") : String(value ?? "");
function groupValue(row: DataRows, kind: "chemical" | "specie", grouping: Grouping): string {
  const count = groupCount(row, kind, grouping);
  const id = kind === "chemical" ? row.chemical_val : row.specie_val;
  return count ? grouping[kind] ? `count:${count}` : id : "";
}
function groupCount(row: DataRows, kind: "chemical" | "specie", grouping: Grouping): string {
  const count = kind === "chemical" ? grouping.chemicalOriginal ? row.chemical_val : row.chemical_count_val : row.specie_count_val;
  return isConfiguredCountValue(count) ? count : "";
}
function groupRepresentative(value: string, kind: "chemical" | "specie", grouping: Grouping): Map<string, string> | null {
  return grouping[kind] && value.startsWith("count:") ? grouping.representatives[kind].get(value.slice(6)) ?? null : null;
}
function groupingFromResponses(responses: Array<{ entity_groups?: EntityGroups }>, chemicalCountKey: string, chemKey: string, speciesCountKey: string, specieKey: string): Grouping {
  const representatives = { chemical: new Map<string, Map<string, string>>(), specie: new Map<string, Map<string, string>>() };
  const metadata = { chemical: [] as DataMeta[], specie: [] as DataMeta[] };
  for (const response of responses) {
    for (const kind of ["chemical", "specie"] as const) {
      const group = kind === "chemical" ? response.entity_groups?.chemical : response.entity_groups?.species;
      if (!group) continue;
      if (metadata[kind].length === 0) metadata[kind] = group.columns.map(detailMeta);
      for (const item of group.items) {
        const id = rowValue(item[group.primary_column]).trim();
        if (id && !representatives[kind].has(id)) representatives[kind].set(id, new Map(Object.entries(item).map(([key, value]) => [key, rowValue(value)])));
      }
    }
  }
  return { chemical: Boolean(chemicalCountKey && chemicalCountKey !== chemKey), specie: Boolean(speciesCountKey && speciesCountKey !== specieKey), representatives, metadata };
}

function filterRows(
  rows: DataRows[],
  specie: string,
  chemical: string,
  grouping: Grouping,
): DataRows[] {
  return rows.filter(
    (dr) =>
      (specie === "" || groupValue(dr, "specie", grouping) === specie) &&
      (chemical === "" || groupValue(dr, "chemical", grouping) === chemical),
  );
}

function buildOptions(
  rows: DataRows[],
  kind: "specie" | "chemical",
  mode: CountMode,
  refColumns: string[],
  meta: DataMeta[],
  grouping: Grouping,
): SelectOption[] {
  const aggregates = new Map<string, OptionAggregate>();
  rows.forEach((dr) => {
    const v = groupValue(dr, kind, grouping);
    if (!v) return;
    let agg = aggregates.get(v);
    if (!agg) {
      agg = {
        value: v,
        label: labelForGroup(dr, meta, kind, v, grouping),
        total: 0,
        counterparts: new Set<string>(),
        articles: new Set<string>(),
      };
      aggregates.set(v, agg);
    } else if (agg.label === v) {
      const label = labelForGroup(dr, meta, kind, v, grouping);
      if (label) agg.label = label;
    }
    agg.total += dr.total_length;
    const counterpart = groupCount(dr, kind === "specie" ? "chemical" : "specie", grouping);
    if (isConfiguredCountValue(counterpart)) agg.counterparts.add(counterpart);
    if (mode === "articles") {
      dr.value_rows.forEach((row) =>
        collectUniqueTokensFromRow(row, refColumns, agg.articles),
      );
    }
  });
  return [...aggregates.values()]
    .map((agg) => ({
      value: agg.value,
      label: agg.label,
      count:
        mode === "chemicals"
          ? agg.counterparts.size
          : mode === "articles"
            ? agg.articles.size
            : agg.total,
    }));
}

/** Union of values across all compare series, with summed per-query counts. */
function buildOptionsWithSeries(
  primaryRows: DataRows[],
  kind: "specie" | "chemical",
  mode: CountMode,
  refColumns: string[],
  meta: DataMeta[],
  series: Array<{ color: string; rows: DataRows[] | "primary" }>,
  grouping: Grouping,
): SelectOption[] {
  if (series.length <= 1) {
    return buildOptions(primaryRows, kind, mode, refColumns, meta, grouping);
  }
  const resolved = series.map(({ color, rows: srows }) => ({
    color,
    rows: srows === "primary" ? primaryRows : srows,
  }));
  const optionsBySeries = resolved.map(({ color, rows }) => ({
    color,
    options: buildOptions(rows, kind, mode, refColumns, meta, grouping),
  }));
  const optionMaps = optionsBySeries.map(({ color, options }) => ({
    color,
    options: new Map(options.map((option) => [option.value, option])),
  }));
  const labels = new Map<string, string>();
  const values = new Set<string>();
  optionsBySeries.forEach(({ options }) => {
    options.forEach((option) => {
      values.add(option.value);
      if (!labels.has(option.value) || labels.get(option.value) === option.value) {
        labels.set(option.value, option.label);
      }
    });
  });
  return [...values]
    .map((value) => {
      const seriesCounts = optionMaps.map(({ color, options }) => ({
        color,
        n: options.get(value)?.count ?? 0,
      }));
      return {
        value,
        label: labels.get(value) ?? value,
        count: seriesCounts.reduce((acc, s) => acc + s.n, 0),
        seriesCounts,
      };
    });
}

/** Counts and selection validity need entity keys, not sorted display options. */
export function entityValues(
  series: Array<{ rows: DataRows[] }>,
  kind: "specie" | "chemical",
  counterpart = "",
  grouping?: Grouping,
): Set<string> {
  const values = new Set<string>();
  for (const { rows } of series) {
    for (const row of rows) {
      const other = grouping ? groupValue(row, kind === "specie" ? "chemical" : "specie", grouping) : kind === "specie" ? row.chemical_val : row.specie_val;
      if (counterpart === "" || other === counterpart) {
        const value = grouping ? groupValue(row, kind, grouping) : kind === "specie" ? row.specie_val : row.chemical_val;
        if (value) values.add(value);
      }
    }
  }
  return values;
}

function countedEntityValues(
  series: Array<{ rows: DataRows[] }>,
  kind: "specie" | "chemical",
  grouping: Grouping,
): Set<string> {
  return entityValues(series, kind, "", grouping);
}

function chemicalListLabel(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.split("=")[0]?.trim() || fallback;
}

function speciesListLabel(row: Map<string, string>, meta: DataMeta[], fallback: string): string {
  const columns = meta
    .filter((m) => m.is_specie && m.classification_level != null && (row.get(m.name) ?? "").trim() !== "")
    .sort((a, b) => (b.classification_level ?? 0) - (a.classification_level ?? 0));
  const preferred = [1, 0]
    .map((level) => columns.find((m) => m.classification_level === level))
    .filter((m): m is DataMeta => Boolean(m));
  const selected = preferred.length > 0 ? preferred : columns.slice(-2);
  const parts = selected.map((column) => (row.get(column.name) ?? "").trim()).filter(Boolean);
  const label = parts.join(" ").trim();
  return label || fallback;
}

function labelForDataRow(
  dr: DataRows,
  meta: DataMeta[],
  kind: "specie" | "chemical",
): string {
  if (kind === "chemical") {
    const markedColumn = meta.find((m) => m.is_chemical && m.is_list_name)?.name;
    if (markedColumn) {
      const marked = chemicalListLabel(dr.chemical_row.get(markedColumn), "");
      if (marked) return marked;
    }
    return chemicalListLabel(
      dr.chemical_row.get("trivial_names") ?? dr.chemical_row.get("names"),
      "",
    );
  }
  return speciesListLabel(dr.specie_row, meta, "");
}

function labelForGroup(dr: DataRows, meta: DataMeta[], kind: "specie" | "chemical", value: string, grouping: Grouping): string {
  const representative = groupRepresentative(value, kind, grouping);
  if (representative) {
    const sourceMeta = grouping.metadata[kind];
    return kind === "chemical"
      ? chemicalListLabel(representative.get(sourceMeta.find(column => column.is_list_name)?.name ?? "") ?? representative.get("names"), value.slice(6))
      : speciesListLabel(representative, sourceMeta, value.slice(6));
  }
  // A count key without a source representative cannot identify a canonical
  // stereoisomer. Use the stable group value rather than a random joined row.
  if (grouping[kind] && value.startsWith("count:")) return value.slice(6);
  return labelForDataRow(dr, meta, kind) || (value.startsWith("id:") ? value.slice(3) : value);
}

/** Build DataRows from raw search rows using already-parsed meta + key columns. */
const groupedRowsCache = new WeakMap<object, {
  meta: DataMeta[];
  chemKey: string;
  specieKey: string;
  chemicalCountKey: string;
  speciesCountKey: string;
  rows: DataRows[];
}>();

export function rowsFromResponseData(
  dataItems: Array<{ [index: string]: any }>,
  meta: DataMeta[],
  chemKey: string,
  specieKey: string,
  chemicalCountKey = chemKey,
  speciesCountKey = specieKey,
): DataRows[] {
  // Search snapshots and their grouped rows are immutable after construction.
  const cached = groupedRowsCache.get(dataItems);
  if (cached?.meta === meta && cached.chemKey === chemKey && cached.specieKey === specieKey &&
    cached.chemicalCountKey === chemicalCountKey && cached.speciesCountKey === speciesCountKey) {
    return cached.rows;
  }
  const map = new Map<string, DataRows>();

  dataItems.forEach((data_item) => {
    const chem_row = new Map<string, string>();
    const specie_row = new Map<string, string>();
    const value_row = new Map<string, string>();
    const chemicalIdentity: Array<[string, unknown]> = [];
    const speciesIdentity: Array<[string, unknown]> = [];
    meta.forEach((m) => {
      const rawItem = data_item[m.name];
      const item = rawItem != null ? String(rawItem) : "";
      // SMILES is often typed without `table_`, so is_chemical is false — still attach to chem.
      // A configured count key can be hidden, so retain it without making it part
      // of the existing entity grouping or navigation identity.
      const isChemicalEntityColumn = m.is_chemical || m.type === "smiles" || ((m.is_primary || m.is_key_column) && m.entity_kind === "chemical");
      const isSpeciesEntityColumn = m.is_specie || ((m.is_primary || m.is_key_column) && m.entity_kind === "specie");
      if (isChemicalEntityColumn || m.name === chemicalCountKey) {
        chem_row.set(m.name, item);
        if (isChemicalEntityColumn) chemicalIdentity.push([m.name, rawItem]);
      } else if (isSpeciesEntityColumn || m.name === speciesCountKey) {
        specie_row.set(m.name, item);
        if (isSpeciesEntityColumn) speciesIdentity.push([m.name, rawItem]);
      }
      else value_row.set(m.name, item);
    });
    const key = resultGroupIdentity(chemicalIdentity, speciesIdentity);
    if (!map.has(key)) {
      map.set(
        key,
        new DataRows(specie_row, specieKey, speciesCountKey, chem_row, chemKey, chemicalCountKey, []),
      );
    }
    map.get(key)?.add_row(value_row);
  });
  const rows = [...map.values()];
  groupedRowsCache.set(dataItems, { meta, chemKey, specieKey, chemicalCountKey, speciesCountKey, rows });
  return rows;
}

type SeriesRowSet = { color: string; rows: DataRows[] };
type CompareRowSetInput = { color: string; rows: DataRows[] | "primary" };

function resolveCompareRowSets(
  primaryRows: DataRows[],
  series: Array<{ color: string; rows: DataRows[] | "primary" }>,
): SeriesRowSet[] {
  if (series.length <= 1) {
    return [{ color: "", rows: primaryRows }];
  }
  return series.map(({ color, rows: srows }) => ({
    color,
    rows: srows === "primary" ? primaryRows : srows,
  }));
}

function collectArticleSeriesColors(
  filteredBySeries: SeriesRowSet[],
  refColumns: string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  filteredBySeries.forEach(({ color, rows }) => {
    if (!color) return;
    const articles = new Set<string>();
    rows.forEach((dr) => {
      dr.value_rows.forEach((row) =>
        collectUniqueTokensFromRow(row, refColumns, articles),
      );
    });
    articles.forEach((id) => {
      const list = out.get(id) ?? [];
      if (!list.includes(color)) list.push(color);
      out.set(id, list);
    });
  });
  return out;
}

type ResultValueRow = {
  values: Map<string, string>;
  specie: string;
  chemical: string;
};

function mergeValueRowsFromSeries(
  filteredBySeries: SeriesRowSet[],
  refColumns: string[],
): ResultValueRow[] {
  const seen = new Set<string>();
  const out: ResultValueRow[] = [];
  filteredBySeries.forEach(({ rows }) => {
    rows.forEach((dr) => {
      dr.value_rows.forEach((row) => {
        const key = resultRowIdentity(
          dr.specie_val,
          dr.chemical_val,
          row,
          refColumns,
        );
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          values: row,
          specie: dr.specie_val,
          chemical: dr.chemical_val,
        });
      });
    });
  });
  return out;
}

function flattenFilteredDataRows(filteredBySeries: SeriesRowSet[]): DataRows[] {
  return filteredBySeries.flatMap((s) => s.rows);
}

function findChemicalRow(
  primaryRows: DataRows[],
  seriesSets: SeriesRowSet[],
  chemical: string,
  smilesKey = "",
  grouping: Grouping,
): Map<string, string> | null {
  if (!chemical) return null;
  const representative = groupRepresentative(chemical, "chemical", grouping);
  if (representative) return representative;
  if (grouping.chemical && chemical.startsWith("count:")) return null;
  let fallback: Map<string, string> | null = null;
  const pools = [primaryRows, ...seriesSets.map((s) => s.rows)];
  for (const rows of pools) {
    for (const dr of rows) {
      if (groupValue(dr, "chemical", grouping) !== chemical) continue;
      const row = dr.chemical_row;
      if (!fallback) fallback = row;
      if (smilesKey && (row.get(smilesKey) ?? "").trim() !== "") {
        return row;
      }
    }
  }
  return fallback;
}

function findSpecieRow(
  primaryRows: DataRows[],
  seriesSets: SeriesRowSet[],
  specie: string,
  grouping: Grouping,
): Map<string, string> | null {
  if (!specie) return null;
  const representative = groupRepresentative(specie, "specie", grouping);
  if (representative) return representative;
  if (grouping.specie && specie.startsWith("count:")) return null;
  for (const dr of primaryRows) {
    if (groupValue(dr, "specie", grouping) === specie) return dr.specie_row;
  }
  for (const { rows } of seriesSets) {
    const found = rows.find((dr) => groupValue(dr, "specie", grouping) === specie);
    if (found) return found.specie_row;
  }
  return null;
}

// A species page is the lowest original classification rank. The page itself
// supplies the genus + species title from the source taxonomy.
function speciesTaxonLink(
  row: Map<string, string> | null,
  meta: DataMeta[],
): TaxonLink | undefined {
  if (!row) return undefined;
  const speciesColumn = meta.find((column) =>
    column.is_specie && column.classification_level === 0,
  );
  const name = speciesColumn ? (row.get(speciesColumn.name) ?? "").trim() : "";
  return name ? { rank: 0, name } : undefined;
}

function entityID(row: Map<string, string> | null, meta: DataMeta[], kind: "chemical" | "specie"): string {
  // A primary query field is not necessarily the stable source-row ID. In
  // particular, legacy datasets use SMILES and the rank-zero taxon as their
  // primary values. Sending either to /chemical/:id or /species/:id makes the
  // source-ID endpoint look up the wrong key. Keep those legacy page links
  // until an actual non-display source ID is available in the result row.
  const column = meta.find(item =>
    (item.is_primary || item.is_key_column) &&
    item.entity_kind === kind &&
    item.type !== "smiles" &&
    item.classification_level === null,
  );
  return column ? (row?.get(column.name) ?? "").trim() : "";
}

/** SMILES keyed by chemical name across every compare series (no specie filter). */
function buildChemicalSmilesMap(
  primaryRows: DataRows[],
  seriesSets: SeriesRowSet[],
  smilesKey: string,
  grouping: Grouping,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!smilesKey) return map;
  const ingest = (rows: DataRows[]) => {
    rows.forEach((dr) => {
      let smiles = (dr.chemical_row.get(smilesKey) ?? "").trim();
      if (!smiles) {
        for (const vr of dr.value_rows) {
          smiles = (vr.get(smilesKey) ?? "").trim();
          if (smiles) break;
        }
      }
      const value = groupValue(dr, "chemical", grouping);
      const representative = groupRepresentative(value, "chemical", grouping);
      if (grouping.chemical && value.startsWith("count:") && !representative) return;
      if (representative) smiles = (representative.get(smilesKey) ?? "").trim();
      if (!smiles) return;
      if (smiles && (!map.has(value) || map.get(value) === "")) {
        map.set(value, smiles);
      }
    });
  };
  ingest(primaryRows);
  seriesSets.forEach(({ rows }) => ingest(rows));
  return map;
}

function ResultTableHead({
  meta,
  referenceCount,
}: {
  meta: Array<DataMeta>;
  referenceCount?: number;
}) {
  return (
    <thead style={{ position: "sticky", top: 0, zIndex: 900 }}>
      <tr>
        {meta.map((curr_meta) => {
          if (curr_meta.is_grouping || curr_meta.is_ignore) {
            return <></>;
          }
          const HeaderIcon =
            curr_meta.type === "reference"
              ? BookOpen
              : curr_meta.type === "smiles"
                ? Molecule
                : null;
          const countSuffix =
            curr_meta.type === "reference" && referenceCount != null
              ? ` (${referenceCount})`
              : "";
          return (
            <th
              key={curr_meta.name}
              scope="col"
              style={{
                backgroundColor: "var(--color-table-header)",
                padding: "0 8px",
              }}
            >
              <p
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  fontFamily: "var(--font-serif)",
                  margin: "14px 0",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {HeaderIcon && <HeaderIcon width={18} height={18} aria-hidden />}
                {curr_meta.show_name}
                {countSuffix}
                &nbsp;
                <InfoTip text={curr_meta.description} />
              </p>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function ResultTableBody({
  rows,
  meta,
  articleSeriesColors,
}: {
  rows: ResultValueRow[];
  meta: Array<DataMeta>;
  articleSeriesColors?: Map<string, string[]>;
}) {
  return (
    <tbody>
      {rows.map((row, rowIdx) => (
        <tr
          key={rowIdx}
          data-row-species={row.specie}
          data-row-chemical={row.chemical}
        >
          {meta.map((meta_val, ind) => {
            if (meta_val.is_grouping || meta_val.is_ignore) {
              return <></>;
            }
            const isRef = meta_val.type === "reference";
            const raw = row.values.get(meta_val.name);
            return (
              <td
                key={meta_val.name}
                style={{
                  minWidth: isRef ? "200px" : "120px",
                  maxWidth: isRef ? "360px" : "220px",
                  width: isRef ? "32%" : undefined,
                  textAlign: isRef ? "left" : undefined,
                }}
              >
                {isRef && articleSeriesColors && articleSeriesColors.size > 0
                  ? renderReferenceWithSeriesDots(
                      raw ?? "",
                      articleSeriesColors,
                    )
                  : meta[ind].render(raw)}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  );
}

function SeriesDots({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <span className="ref-series-dots" title="Present in compare queries">
      {colors.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className="ref-series-dot"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

function renderReferenceWithSeriesDots(
  value: string,
  articleSeriesColors: Map<string, string[]>,
) {
  const ids = value
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return <></>;
  return (
    <span className="citation-ref-list">
      {ids.map((id, i) => (
        <span key={`${id}-${i}`} className="citation-ref-list__item">
          {i > 0 && <span className="citation-ref-list__sep">, </span>}
          <CitationPopover articleId={id} />
          <SeriesDots colors={articleSeriesColors.get(id) ?? []} />
        </span>
      ))}
    </span>
  );
}

function ResultTable({
  rows,
  meta,
  referenceCount,
  articleSeriesColors,
}: {
  rows: ResultValueRow[];
  meta: Array<DataMeta>;
  referenceCount?: number;
  articleSeriesColors?: Map<string, string[]>;
}) {
  if (meta.length === 0) {
    return <div></div>;
  }

  return (
    <div className="table">
      <table style={{ margin: "auto" }}>
        {rows.length === 0 ? (
          <caption
            style={{
              padding: "20%",
              border: "1px solid var(--color-border)",
              fontSize: config["FONT_SIZE"],
              backgroundColor: "var(--color-surface)",
              minWidth: "300px",
            }}
          >
            No data for given request
          </caption>
        ) : (
          <>
            <ResultTableHead meta={meta} referenceCount={referenceCount} />
            <ResultTableBody
              meta={meta}
              rows={rows}
              articleSeriesColors={articleSeriesColors}
            />
          </>
        )}
      </table>
    </div>
  );
}

type EntityListView = {
  sortBy: "name" | "count" | null;
  direction: "asc" | "desc";
  filter: string;
};

const defaultEntityListView: EntityListView = { sortBy: "count", direction: "desc", filter: "" };

export function RankedSelectList({
  options,
  countModeLabel,
  onSelect,
  onHover,
  entityLabel = "entity",
  view: controlledView,
  onViewChange,
}: {
  options: SelectOption[];
  countModeLabel: string;
  onSelect: (value: string) => void;
  onHover?: (value: string | null) => void;
  entityLabel?: string;
  view?: EntityListView;
  onViewChange?: (view: EntityListView) => void;
}) {
  const [localView, setLocalView] = useState(defaultEntityListView);
  const view = controlledView ?? localView;
  const [page, setPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const closeFilter = () => {
    setFilterOpen(false);
    filterButton.current?.focus();
  };
  const visibleOptions = useMemo(() => {
    const query = view.filter.trim().toLocaleLowerCase();
    const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query));
    if (view.sortBy === null) return filtered;
    const direction = view.direction === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
        const names = a.label.localeCompare(b.label);
        const primary = view.sortBy === "name" ? names : a.count - b.count;
        return primary * direction || names || a.value.localeCompare(b.value);
      });
  }, [options, view]);
  const changeView = (next: EntityListView) => {
    (onViewChange ?? setLocalView)(next);
    setPage(0);
    onHover?.(null);
  };
  const pageSize = 100;
  const lastPage = Math.max(0, Math.ceil(visibleOptions.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  if (options.length === 0) {
    return <p className="empty-state" style={{ padding: 12 }}>No items</p>;
  }
  return (
    <div className="ranked-select-list__layout">
    {visibleOptions.length > pageSize && (
      <nav aria-label="Entity list pages" style={{ display: "flex", alignItems: "center", gap: 8, padding: 8 }}>
        <button type="button" className="btn" title="Previous page" aria-label="Previous page" disabled={currentPage === 0}
          onClick={() => { setPage(currentPage - 1); onHover?.(null); }}><ChevronLeft width={16} height={16} /></button>
        <span>{start + 1}-{Math.min(start + pageSize, visibleOptions.length)} of {visibleOptions.length}</span>
        <button type="button" className="btn" title="Next page" aria-label="Next page" disabled={currentPage === lastPage}
          onClick={() => { setPage(currentPage + 1); onHover?.(null); }}><ChevronRight width={16} height={16} /></button>
      </nav>
    )}
    <div className="ranked-select-list__controls"
      onKeyDown={event => { if (event.key === "Escape" && filterOpen) { event.preventDefault(); closeFilter(); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFilterOpen(false); }}>
        {(["name", "count"] as const).map(sortBy => {
          const label = sortBy === "name" ? "Name" : "Count";
          return <div key={sortBy} className={`ranked-select-list__column ranked-select-list__column--${sortBy}`}>
            <span title={sortBy === "count" ? countModeLabel : undefined}
              aria-label={sortBy === "count" ? `Count (${countModeLabel})` : undefined}>{label}</span>
            <div className="ranked-select-list__sort" role="group" aria-label={`Sort ${entityLabel} by ${sortBy}`}>
              {(() => {
                const active = view.sortBy === sortBy;
                const nextDirection = !active ? "asc" : view.direction === "asc" ? "desc" : null;
                const CurrentIcon = !active ? ArrowUpArrowDown : view.direction === "asc" ? ChevronUp : ChevronDown;
                const state = !active ? "not sorted" : view.direction === "asc" ? "ascending" : "descending";
                const next = nextDirection === null ? "clear sorting" : `sort ${nextDirection === "asc" ? "ascending" : "descending"}`;
                return <button type="button" aria-pressed={active}
                  aria-label={`Sort by ${sortBy}: ${state}; next click will ${next}`}
                  title={`Currently ${state}; next click will ${next}`}
                  onClick={() => changeView({ ...view, sortBy: nextDirection === null ? null : sortBy, direction: nextDirection ?? "asc" })}>
                  <CurrentIcon width={14} height={14} aria-hidden />
                </button>;
              })()}
              {sortBy === "name" && <button ref={filterButton} type="button" aria-label={`Filter ${entityLabel} names`}
                title="Filter names" aria-expanded={filterOpen} aria-haspopup="dialog"
                className={view.filter.trim() ? "ranked-select-list__filter-active" : undefined}
                onClick={() => setFilterOpen(!filterOpen)}><Funnel width={14} height={14} aria-hidden /></button>}
            </div>
          </div>;
        })}
      {filterOpen && <div className="ranked-select-list__filter" role="dialog" aria-label={`Filter ${entityLabel} names`}>
        <input autoFocus type="search" value={view.filter} placeholder="Filter names…"
          aria-label={`Filter ${entityLabel} names`}
          onChange={event => changeView({ ...view, filter: event.target.value })} />
        <div className="ranked-select-list__filter-actions">
          <button type="button" onClick={() => { changeView({ ...view, filter: "" }); closeFilter(); }}>Clear</button>
          <button type="button" onClick={closeFilter}>Close</button>
        </div>
      </div>}
      {view.filter.trim() && <span className="ranked-select-list__matches" role="status">{visibleOptions.length} of {options.length} names</span>}
    </div>
    <ol
      className="ranked-select-list"
      onMouseLeave={() => onHover?.(null)}
    >
      {visibleOptions.slice(start, start + pageSize).map((opt, i) => (
        <li key={opt.value}>
          <button
            type="button"
            className="ranked-select-list__item"
            onClick={() => onSelect(opt.value)}
            onMouseEnter={() => onHover?.(opt.value)}
            onFocus={() => onHover?.(opt.value)}
            onBlur={() => onHover?.(null)}
          >
            <span className="ranked-select-list__index">{start + i + 1}.</span>
            <span className="ranked-select-list__value">{opt.label}</span>
            <span className="ranked-select-list__count" title={countModeLabel}
              aria-label={(opt.seriesCounts?.length ?? 0) > 1 ? undefined : `${countModeLabel}: ${opt.count}`}>
              {(() => {
                const visible = (opt.seriesCounts ?? []).filter((s) => s.n > 0);
                if ((opt.seriesCounts?.length ?? 0) > 1 && visible.length > 0) {
                  return (
                    <span className="ranked-select-list__series">
                      {visible.map((s, i) => (
                        <span
                          key={i}
                          className="ranked-select-list__series-n"
                          style={{
                            color: s.color,
                            borderColor: s.color,
                            background: `color-mix(in srgb, ${s.color} 12%, var(--color-surface))`,
                          }}
                        >
                          {s.n}
                        </span>
                      ))}
                    </span>
                  );
                }
                return (
                  <>
                    {opt.count}
                  </>
                );
              })()}
            </span>
          </button>
        </li>
      ))}
    </ol>
    {visibleOptions.length === 0 && <p className="empty-state" style={{ padding: 12 }}>No matching names</p>}
    </div>
  );
}

function DetailAttributeTable({ meta, row, kind }: { meta: DataMeta[]; row: Map<string, string>; kind: "chemical" | "specie" }) {
  return <EntityDetailTable meta={meta.filter(column => kind === "chemical" ? column.is_chemical && column.type !== "smiles" : column.is_specie)} row={row} />;
}

function SidePanel({
  kind,
  title,
  listCount,
  selected,
  onClear,
  options,
  countModeLabel,
  onSelect,
  onHover,
  detailRow,
  meta,
  smilesLink,
  taxonLink,
  entityID,
}: {
  kind: "chemical" | "specie";
  title: string;
  listCount: number;
  selected: string;
  onClear: () => void;
  options: SelectOption[];
  countModeLabel: string;
  onSelect: (value: string) => void;
  onHover?: (value: string | null) => void;
  detailRow: Map<string, string> | null;
  meta: DataMeta[];
  smilesLink?: string;
  taxonLink?: TaxonLink;
  entityID?: string;
}) {
  const [listView, setListView] = useState(defaultEntityListView);
  const BadgeIcon = kind === "chemical" ? Molecule : BranchesRight;
  const badgeClass =
    kind === "chemical" ? "badge badge-chemical" : "badge badge-species";

  return (
    <Container
      maxHeight="520px"
      dataTour={kind === "chemical" ? "table-chemical-panel" : "table-species-panel"}
      style={{
        flex: "1 1 320px",
        minWidth: 280,
        maxWidth: 440,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <div className="side-panel__header">
        <span className={badgeClass}>
          <BadgeIcon width={16} height={16} aria-hidden />
          {title} ({listCount})
        </span>
        {selected !== "" && (
          <button
            type="button"
            className="btn side-panel__clear"
            onClick={onClear}
            title="Back to list"
            aria-label="Back to list"
          >
            <Xmark width={16} height={16} />
          </button>
        )}
      </div>

      {selected === "" ? (
        <RankedSelectList
          options={options}
          countModeLabel={countModeLabel}
          onSelect={onSelect}
          onHover={onHover}
          entityLabel={kind === "chemical" ? "chemical" : "species"}
          view={listView}
          onViewChange={setListView}
        />
      ) : detailRow ? (
        <>
          {kind === "chemical" && (Boolean(entityID) || Boolean(smilesLink)) && (
            <p style={{ textAlign: "center", marginTop: 8, marginBottom: 12 }}>
              <Link
                to={entityID ? `/chemical/${encodeURIComponent(entityID)}` : substancePagePath(smilesLink ?? "")}
                className="link-button"
              >
                Open substance page
                <ChevronRight />
              </Link>
            </p>
          )}
          {taxonLink && (
            <p style={{ textAlign: "center", marginTop: 8, marginBottom: 12 }}>
              <Link
                to={entityID ? `/species/${encodeURIComponent(entityID)}` : taxonPath(taxonLink)}
                className="link-button"
              >
                Open species page
                <ChevronRight />
              </Link>
            </p>
          )}
          <DetailAttributeTable meta={meta} row={detailRow} kind={kind} />
        </>
      ) : null}
    </Container>
  );
}

function ResultsWorkspace({
  rows,
  meta,
  currentSpecie,
  setCurrentSpecie,
  currentChemical,
  setCurrentChemical,
  countMode,
  refColumns,
  seriesRowSets,
  grouping,
}: {
  rows: DataRows[];
  meta: DataMeta[];
  currentSpecie: string;
  setCurrentSpecie: (v: string) => void;
  currentChemical: string;
  setCurrentChemical: (v: string) => void;
  countMode: CountMode;
  refColumns: string[];
  seriesRowSets: CompareRowSetInput[];
  grouping: Grouping;
}) {
  const smilesMeta = meta.find((m) => m.type === "smiles");
  const smilesKey = smilesMeta?.name ?? "";
  const [hoveredChemical, setHoveredChemical] = useState("");
  const [hoveredSpecie, setHoveredSpecie] = useState("");

  const previewChemical =
    currentChemical !== "" ? currentChemical : hoveredChemical;
  const previewSpecie =
    currentSpecie !== "" ? currentSpecie : hoveredSpecie;

  // Neighbor lists follow preview (selection or hover), like a soft selection.
  const rowsForSpeciesList =
    previewChemical === ""
      ? rows
      : rows.filter((dr) => groupValue(dr, "chemical", grouping) === previewChemical);
  const rowsForChemicalList =
    previewSpecie === ""
      ? rows
      : rows.filter((dr) => groupValue(dr, "specie", grouping) === previewSpecie);

  const speciesCountMode: CountMode =
    hoveredChemical !== "" ? "articles" : countMode;
  const chemicalsCountMode: CountMode =
    hoveredSpecie !== "" ? "articles" : countMode;

  const speciesOptions = buildOptionsWithSeries(
    rowsForSpeciesList,
    "specie",
    speciesCountMode,
    refColumns,
    meta,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : previewChemical === ""
            ? srows
            : srows.filter((dr) => groupValue(dr, "chemical", grouping) === previewChemical),
    })),
    grouping,
  );
  const chemicalsOptions = buildOptionsWithSeries(
    rowsForChemicalList,
    "chemical",
    chemicalsCountMode,
    refColumns,
    meta,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : previewSpecie === ""
            ? srows
            : srows.filter((dr) => groupValue(dr, "specie", grouping) === previewSpecie),
    })),
    grouping,
  );
  const chemicalSmiles = buildChemicalSmilesMap(
    rows,
    resolveCompareRowSets(rows, seriesRowSets),
    smilesKey,
    grouping,
  );

  const tourRestoreRef = useRef<"chemical" | "specie" | null>(null);
  useEffect(() => {
    const onTour = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        action?: string;
        prepare?: string;
      };
      if (detail?.prepare !== "table-select") return;
      if (detail.action === "enter") {
        if (currentChemical !== "" || currentSpecie !== "") return;
        if (chemicalsOptions[0]?.value) {
          tourRestoreRef.current = "chemical";
          setCurrentChemical(chemicalsOptions[0].value);
        } else if (speciesOptions[0]?.value) {
          tourRestoreRef.current = "specie";
          setCurrentSpecie(speciesOptions[0].value);
        }
      } else if (detail.action === "leave") {
        if (tourRestoreRef.current === "chemical") setCurrentChemical("");
        if (tourRestoreRef.current === "specie") setCurrentSpecie("");
        tourRestoreRef.current = null;
      }
    };
    window.addEventListener("fuco-tour", onTour);
    return () => window.removeEventListener("fuco-tour", onTour);
  }, [
    chemicalsOptions,
    speciesOptions,
    currentChemical,
    currentSpecie,
    setCurrentChemical,
    setCurrentSpecie,
  ]);

  const resolvedSeries = resolveCompareRowSets(rows, seriesRowSets);
  const previewFilteredBySeries = resolvedSeries.map(({ color, rows: srows }) => ({
    color,
    rows: filterRows(srows, previewSpecie, previewChemical, grouping),
  }));
  const showPublications = previewSpecie !== "" || previewChemical !== "";
  const valueRows = showPublications
    ? mergeValueRowsFromSeries(previewFilteredBySeries, refColumns)
    : [];
  const articleSeriesColors =
    showPublications && seriesRowSets.length > 1
      ? collectArticleSeriesColors(previewFilteredBySeries, refColumns)
      : undefined;
  const referenceCount = showPublications ? uniqueArticleCountInRows(
    flattenFilteredDataRows(previewFilteredBySeries),
    refColumns,
  ) : 0;

  const chemicalDetail = findChemicalRow(
    rows,
    resolvedSeries,
    currentChemical,
    smilesKey,
    grouping,
  );
  const specieDetail = findSpecieRow(rows, resolvedSeries, currentSpecie, grouping);

  const selectedSmiles =
    currentChemical !== "" && chemicalDetail && smilesKey
      ? (chemicalDetail.get(smilesKey) ?? "").trim()
      : "";
  const displaySmiles =
    selectedSmiles ||
    (currentChemical !== ""
      ? chemicalSmiles.get(currentChemical) ?? ""
      : "") ||
    (hoveredChemical !== ""
      ? chemicalSmiles.get(hoveredChemical) ?? ""
      : "");

  const speciesCountLabel =
    speciesCountMode === "chemicals" ? grouping.chemicalOriginal ? "chemicals" : "planar" : speciesCountMode;
  const chemicalCountLabel =
    chemicalsCountMode === "chemicals" ? "species" : chemicalsCountMode;

  return (
    <div
      className="grouped-result-row"
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 16,
        width: "100%",
        marginTop: 16,
      }}
    >
      <SidePanel
        kind="chemical"
        title={grouping.chemicalOriginal ? "Chemical" : "Planar"}
        listCount={countedEntityValues(
          resolvedSeries.map(({ rows: srows }) => ({ rows: filterRows(srows, previewSpecie, currentChemical, grouping) })),
          "chemical",
          grouping,
        ).size}
        selected={currentChemical}
        onClear={() => setCurrentChemical("")}
        options={chemicalsOptions}
        countModeLabel={chemicalCountLabel}
        onSelect={(value) => {
          setHoveredChemical("");
          setCurrentChemical(value);
        }}
        onHover={(value) => {
          setHoveredChemical(value ?? "");
        }}
        detailRow={chemicalDetail}
        meta={grouping.chemical && currentChemical.startsWith("count:") ? grouping.metadata.chemical : meta}
        smilesLink={
          selectedSmiles ||
          (currentChemical !== ""
            ? chemicalSmiles.get(currentChemical) ?? ""
            : "")
        }
        entityID={grouping.chemical && currentChemical.startsWith("count:") && chemicalDetail ? currentChemical.slice(6) : entityID(chemicalDetail, meta, "chemical")}
      />

      <div
        data-tour="table-results"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: "0 1 420px",
          minWidth: 320,
          maxWidth: 480,
          minHeight: 0,
        }}
      >
        {smilesMeta && displaySmiles !== "" ? (
          <Container key={displaySmiles}>
            {smilesMeta.render(displaySmiles)}
          </Container>
        ) : (
          <Container>
            <p className="empty-state" style={{ padding: 24, margin: 0 }}>
              {currentChemical === ""
                ? "Hover or select a chemical to show its structure"
                : "No SMILES for this chemical"}
            </p>
          </Container>
        )}

        {!showPublications ? (
          <Container>
            <p className="empty-state" style={{ padding: 24, margin: 0 }}>
              Select species or chemical
            </p>
          </Container>
        ) : (
          <ScrollableContainer height="320px">
            <ResultTable
              rows={valueRows}
              meta={meta}
              referenceCount={referenceCount}
              articleSeriesColors={articleSeriesColors}
            />
          </ScrollableContainer>
        )}
      </div>

      <SidePanel
        kind="specie"
        title="Species"
        listCount={countedEntityValues(
          resolvedSeries.map(({ rows: srows }) => ({ rows: filterRows(srows, currentSpecie, previewChemical, grouping) })),
          "specie",
          grouping,
        ).size}
        selected={currentSpecie}
        onClear={() => setCurrentSpecie("")}
        options={speciesOptions}
        countModeLabel={speciesCountLabel}
        onSelect={(value) => {
          setHoveredSpecie("");
          setCurrentSpecie(value);
        }}
        onHover={(value) => {
          setHoveredSpecie(value ?? "");
        }}
        detailRow={specieDetail}
        meta={grouping.specie && currentSpecie.startsWith("count:") ? grouping.metadata.specie : meta}
        taxonLink={speciesTaxonLink(specieDetail, meta)}
        entityID={grouping.specie && currentSpecie.startsWith("count:") && specieDetail ? currentSpecie.slice(6) : entityID(specieDetail, meta, "specie")}
      />
    </div>
  );
}

function dataRowsToAoA(
  rows: Array<DataRows>,
  meta: Array<DataMeta>,
): string[][] {
  const header = meta.map((m) => m.name);
  const body: string[][] = [];
  rows.forEach((dataRows) => {
    dataRows.value_rows.forEach((currRow) => {
      body.push(
        meta.map((curr_meta) => {
          let value: string | undefined;
          if (curr_meta.is_chemical || curr_meta.type === "smiles") {
            value = dataRows.chemical_row.get(curr_meta.name);
          } else if (curr_meta.is_specie) {
            value = dataRows.specie_row.get(curr_meta.name);
          } else {
            value = currRow.get(curr_meta.name);
          }
          return value === undefined ? "" : String(value);
        }),
      );
    });
  });
  return [header, ...body];
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]]/g, "_").trim() || "Sheet";
  if (base.length > 28) base = base.slice(0, 28);
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = `_${i}`;
    candidate = (base.slice(0, Math.max(1, 31 - suffix.length)) + suffix).slice(
      0,
      31,
    );
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export type DownloadSheet = {
  query: string;
  color: string;
  fetchedAt: string;
  rows: DataRows[];
};

function downloadResultsWorkbook(
  sheets: DownloadSheet[],
  meta: Array<DataMeta>,
) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const downloadedAt = new Date().toISOString();
  const frontendHost =
    typeof window !== "undefined"
      ? window.location.origin || window.location.host
      : "";

  const aboutAoA: string[][] = [
    ["Field", "Value"],
    ["Frontend host", frontendHost],
    ["Downloaded at (ISO)", downloadedAt],
    ["Query count", String(sheets.length)],
    [],
    ["#", "Query", "Color", "Fetched at (ISO)", "Rows"],
    ...sheets.map((s, i) => [
      String(i + 1),
      s.query,
      s.color,
      s.fetchedAt,
      String(s.rows.reduce((acc, dr) => acc + dr.value_rows.length, 0)),
    ]),
  ];
  const aboutWs = XLSX.utils.aoa_to_sheet(aboutAoA);
  XLSX.utils.book_append_sheet(
    wb,
    aboutWs,
    sanitizeSheetName("About", usedNames),
  );

  sheets.forEach((s, i) => {
    const short =
      s.query.length > 20 ? `${s.query.slice(0, 17)}...` : s.query;
    const name = sanitizeSheetName(`Q${i + 1} ${short}`, usedNames);
    const ws = XLSX.utils.aoa_to_sheet(dataRowsToAoA(s.rows, meta));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  XLSX.writeFile(wb, "results.xlsx");
}

function filterCountMode(countMode: CountMode, from: CountMode, to: string) {
  if (countMode === from) {
    return to;
  }
  return countMode;
}

function TableStateBar({
  rows,
  downloadSheets,
  meta,
  currentSpecie,
  currentChemical,
  countMode,
  setCountMode,
  countModeLocked,
  speciesCount,
  chemicalCount,
  referenceCount,
  primaryQuery = "",
  compareBarPrimaryQuery = primaryQuery,
  colorsByQuery = {},
  grouping,
  countColumns,
  chemicalIdentityMode,
  setChemicalIdentityMode,
}: {
  rows: DataRows[];
  downloadSheets: DownloadSheet[];
  meta: DataMeta[];
  currentSpecie: string;
  currentChemical: string;
  countMode: CountMode;
  setCountMode: (value: CountMode) => void;
  countModeLocked: boolean;
  speciesCount: number;
  chemicalCount: number;
  referenceCount: number;
  primaryQuery?: string;
  compareBarPrimaryQuery?: string;
  colorsByQuery?: Record<string, string>;
  grouping: Grouping;
  countColumns: { chemical: string; specie: string };
  chemicalIdentityMode: "planar" | "all";
  setChemicalIdentityMode: (value: "planar" | "all") => void;
}) {
  let total_rows = 0;
  rows.forEach((data_rows) => {
    if (currentChemical !== "" && groupValue(data_rows, "chemical", grouping) !== currentChemical) {
      return;
    }
    if (currentSpecie !== "" && groupValue(data_rows, "specie", grouping) !== currentSpecie) {
      return;
    }
    total_rows += data_rows.total_length;
  });

  const displayMode: CountMode = countModeLocked ? "articles" : countMode;
  const chemicalLabel = chemicalIdentityMode === "planar" ? "Planar" : "Chemical";
  const countDescription = (kind: string, column: string) => `${kind} total counts distinct nonempty values of ${column} (${meta.find(item => item.name === column)?.show_name ?? column}).`;
  const referenceFields = meta.filter(item => item.type === "reference").map(item => `${item.name} (${item.show_name})`).join(", ") || "none configured";

  return (
    <div className="panel panel-toolbar" data-tour="table-toolbar">
      <div className="count-mode-block" data-tour="table-count-mode">
        <div className="count-mode-block__row">
          <span>Count in lists: </span>
          <InfoTip text={`${chemicalLabel} identity: ${countColumns.chemical} (${meta.find(item => item.name === countColumns.chemical)?.show_name ?? countColumns.chemical}); species identity: ${countColumns.specie} (${meta.find(item => item.name === countColumns.specie)?.show_name ?? countColumns.specie}). Articles count distinct references from ${referenceFields}. All counts observation rows. Each distinct nonempty identity counts once.`} />
          {(["chemicals", "articles", "all"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn-toggle${mode === displayMode ? " is-active" : ""}`}
              disabled={countModeLocked}
              title={
                countModeLocked
                  ? "When a species or chemical is selected, counts are by articles"
                  : undefined
              }
              onClick={() => {
                if (!countModeLocked) setCountMode(mode);
              }}
            >
              {filterCountMode(mode, "chemicals", chemicalIdentityMode === "planar" ? "Planar / species" : "chemicals / species")}
            </button>
          ))}
          <div className="count-mode-block__row" role="group" aria-label="Chemical identity" style={{ marginLeft: 16 }}>
            <span>Chemicals: </span>
            {(["planar", "all"] as const).map(mode => (
              <button key={mode} type="button" className={`btn-toggle${mode === chemicalIdentityMode ? " is-active" : ""}`} aria-pressed={mode === chemicalIdentityMode} onClick={() => setChemicalIdentityMode(mode)}>
                {mode === "planar" ? "Planar" : "All"}
              </button>
            ))}
          </div>
        </div>
        <p className="count-mode-block__hint" aria-hidden={!countModeLocked}>
          {countModeLocked ? "(by articles while an item is selected)" : "\u00A0"}
        </p>
      </div>

      <div className="panel-toolbar__compare" data-tour="table-compare">
        <QueryCompareBar
          primaryQuery={compareBarPrimaryQuery}
          colorsByQuery={colorsByQuery}
        />
      </div>

      <label
        data-tour="table-download"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        Download results:
        <button
          type="button"
          className="btn btn-download"
          onClick={() => downloadResultsWorkbook(downloadSheets, meta)}
          title="Download Excel (one sheet per query)"
          aria-label="Download Excel"
          disabled={downloadSheets.length === 0}
        >
          <FileArrowUp style={{ width: 22, height: 22 }} />
        </button>
      </label>

      <label style={{ color: "var(--color-success)" }}>
        Rows in selection:&nbsp;&nbsp;<b>{total_rows}</b>
      </label>

      <span className="panel-toolbar__break" aria-hidden />

      <span className="badge badge-chemical" style={{ fontSize: "0.85rem" }}>
        <Molecule width={14} height={14} aria-hidden />
        {chemicalLabel} ({chemicalCount})
        <InfoTip text={countDescription(chemicalLabel, countColumns.chemical)} />
      </span>
      <span className="badge badge-species" style={{ fontSize: "0.85rem" }}>
        <BranchesRight width={14} height={14} aria-hidden />
        Species ({speciesCount})
        <InfoTip text={countDescription("Species", countColumns.specie)} />
      </span>
      <span
        className="badge"
        style={{
          fontSize: "0.85rem",
          background: "var(--color-surface-alt)",
          border: "1px solid var(--color-border)",
          color: "var(--color-ink)",
        }}
      >
        <BookOpen width={14} height={14} aria-hidden />
        Reference ({referenceCount})
      </span>
    </div>
  );
}

function ResultTableWrapper({
  rows,
  meta,
  chemKey,
  specieKey,
  chemicalCountKey,
  speciesCountKey,
  compareSeries = [],
  colorsByQuery = {},
  primaryQuery = "",
  compareBarPrimaryQuery = primaryQuery,
  loading = false,
  grouping: planarGrouping,
}: {
  rows: Array<DataRows>;
  meta: Array<DataMeta>;
  chemKey: string;
  specieKey: string;
  chemicalCountKey: string;
  speciesCountKey: string;
  compareSeries?: CompareSeries[];
  colorsByQuery?: Record<string, string>;
  primaryQuery?: string;
  compareBarPrimaryQuery?: string;
  loading?: boolean;
  grouping: Grouping;
}) {
  const refColumns = useMemo(() => meta
    .filter((m) => m.type === "reference")
    .map((m) => m.name), [meta]);

  const location = useLocation();
  const navigate = useNavigate();
  // Keep panel choices on this history entry so Back restores the workspace.
  const saved = location.state?.resultTable;
  const identityParam = new URLSearchParams(location.search).get("chemical_identity");
  const chemicalIdentityMode: "planar" | "all" = identityParam === "all" ? "all" : identityParam === "planar" ? "planar" : saved?.chemicalIdentityMode ?? "planar";
  const grouping = useMemo(() => chemicalIdentityMode === "all" ? { ...planarGrouping, chemical: false, chemicalOriginal: true } : planarGrouping, [chemicalIdentityMode, planarGrouping]);
  const allSpecies = useMemo(() => [...entityValues([{ rows }], "specie", "", grouping)], [rows, grouping]);
  const allChemicals = useMemo(() => [...entityValues([{ rows }], "chemical", "", grouping)], [rows, grouping]);
  const countMode: CountMode = saved?.countMode ?? "chemicals";
  const currentSpecie: string = saved?.currentSpecie ?? (allSpecies.length === 1 && rows.every(row => groupValue(row, "specie", grouping)) ? allSpecies[0] : "");
  const currentChemical: string = saved?.currentChemical ?? (allChemicals.length === 1 && rows.every(row => groupValue(row, "chemical", grouping)) ? allChemicals[0] : "");
  const updateWorkspace = useCallback((changes: {
    countMode?: CountMode; currentSpecie?: string; currentChemical?: string; chemicalIdentityMode?: "planar" | "all";
  }) => {
    const params = new URLSearchParams(location.search);
    if (changes.chemicalIdentityMode) params.set("chemical_identity", changes.chemicalIdentityMode);
    void navigate({ ...location, search: params.toString() }, {
      replace: true,
      state: { ...location.state, resultTable: { countMode, currentSpecie, currentChemical, chemicalIdentityMode, ...changes } },
    });
  }, [navigate, location, countMode, currentSpecie, currentChemical, chemicalIdentityMode]);
  const setCountMode = useCallback((value: CountMode) => updateWorkspace({ countMode: value }), [updateWorkspace]);
  const setCurrentSpecie = useCallback((value: string) => updateWorkspace({ currentSpecie: value }), [updateWorkspace]);
  const setCurrentChemical = useCallback((value: string) => updateWorkspace({ currentChemical: value }), [updateWorkspace]);
  const setChemicalIdentityMode = useCallback((value: "planar" | "all") => {
    if (value !== chemicalIdentityMode) updateWorkspace({ chemicalIdentityMode: value, currentChemical: "" });
  }, [chemicalIdentityMode, updateWorkspace]);

  const countModeLocked = currentSpecie !== "" || currentChemical !== "";
  const effectiveCountMode: CountMode = countModeLocked ? "articles" : countMode;

  const seriesRowSets = useMemo<CompareRowSetInput[]>(
    () =>
      compareSeries.length > 1
        ? compareSeries.map((s, i) => ({
            color: s.color,
            rows:
              i === 0
                ? ("primary" as const)
                : rowsFromResponseData(
                    s.response["data"] ?? [],
                    meta,
                    chemKey,
                    specieKey,
                    chemicalCountKey,
                    speciesCountKey,
                  ),
          }))
        : [],
    [chemicalCountKey, chemKey, compareSeries, meta, rows, specieKey, speciesCountKey],
  );
  const resolvedSeries = resolveCompareRowSets(rows, seriesRowSets);
  const validSpecies = currentSpecie === "" || entityValues(resolvedSeries, "specie", currentChemical, grouping).has(currentSpecie);
  const validChemical = currentChemical === "" || entityValues(resolvedSeries, "chemical", currentSpecie, grouping).has(currentChemical);
  useEffect(() => {
    // Wait for the complete comparison union before clearing restored picks.
    // Clear both together so one replacement cannot restore the other stale pick.
    if (!loading && (!validSpecies || !validChemical)) {
      updateWorkspace({ currentSpecie: validSpecies ? currentSpecie : "", currentChemical: validChemical ? currentChemical : "" });
    }
  }, [loading, validSpecies, validChemical, currentSpecie, currentChemical, updateWorkspace]);

  const filteredBySeries = resolvedSeries.map(({ color, rows: srows }) => ({
    color,
    rows: filterRows(srows, currentSpecie, currentChemical, grouping),
  }));
  const speciesCount = countedEntityValues(filteredBySeries, "specie", grouping).size;
  const chemicalCount = countedEntityValues(filteredBySeries, "chemical", grouping).size;
  const referenceCount = uniqueArticleCountInRows(
    flattenFilteredDataRows(
      currentSpecie === "" && currentChemical === ""
        ? resolvedSeries
        : filteredBySeries,
    ),
    refColumns,
  );

  const downloadSheets: DownloadSheet[] = (() => {
    if (compareSeries.length > 1) {
      return compareSeries.map((s, i) => {
        const srows = resolvedSeries[i]?.rows ?? rows;
        return {
          query: s.query,
          color: s.color,
          fetchedAt: s.fetchedAt,
          rows: filterRows(srows, currentSpecie, currentChemical, grouping),
        };
      });
    }
    const color =
      (primaryQuery && colorsByQuery[primaryQuery]) ||
      compareSeries[0]?.color ||
      "#1E3A8A";
    return [
      {
        query: primaryQuery || compareSeries[0]?.query || "(primary)",
        color,
        fetchedAt: compareSeries[0]?.fetchedAt ?? new Date().toISOString(),
        rows: filterRows(rows, currentSpecie, currentChemical, grouping),
      },
    ];
  })();

  if (resolvedSeries.every((series) => series.rows.length === 0)) {
    return (
      <TableStateBar
        rows={[]}
        downloadSheets={[]}
        meta={meta}
        currentSpecie=""
        currentChemical=""
        countMode="chemicals"
        setCountMode={setCountMode}
        countModeLocked={false}
        speciesCount={0}
        chemicalCount={0}
        referenceCount={0}
        primaryQuery={primaryQuery}
        compareBarPrimaryQuery={compareBarPrimaryQuery}
        colorsByQuery={colorsByQuery}
        grouping={grouping}
        countColumns={{ chemical: chemicalIdentityMode === "all" ? chemKey : chemicalCountKey, specie: speciesCountKey }}
        chemicalIdentityMode={chemicalIdentityMode}
        setChemicalIdentityMode={setChemicalIdentityMode}
      />
    );
  }

  return (
    <>
      <TableStateBar
        rows={
          seriesRowSets.length > 1
            ? flattenFilteredDataRows(resolvedSeries)
            : rows
        }
        downloadSheets={downloadSheets}
        meta={meta}
        currentSpecie={currentSpecie}
        currentChemical={currentChemical}
        countMode={countMode}
        setCountMode={setCountMode}
        countModeLocked={countModeLocked}
        speciesCount={speciesCount}
        chemicalCount={chemicalCount}
        referenceCount={referenceCount}
        primaryQuery={primaryQuery}
        compareBarPrimaryQuery={compareBarPrimaryQuery}
        colorsByQuery={colorsByQuery}
        grouping={grouping}
        countColumns={{ chemical: chemicalIdentityMode === "all" ? chemKey : chemicalCountKey, specie: speciesCountKey }}
        chemicalIdentityMode={chemicalIdentityMode}
        setChemicalIdentityMode={setChemicalIdentityMode}
      />
      <ResultsWorkspace
        key={chemicalIdentityMode}
        rows={rows}
        meta={meta}
        currentSpecie={currentSpecie}
        setCurrentSpecie={setCurrentSpecie}
        currentChemical={currentChemical}
        setCurrentChemical={setCurrentChemical}
        countMode={effectiveCountMode}
        refColumns={refColumns}
        seriesRowSets={seriesRowSets}
        grouping={grouping}
      />
    </>
  );
}

function ResultTableOrNull({
  compareSeries = [],
  colorsByQuery = {},
  primaryQuery = "",
  compareBarPrimaryQuery = primaryQuery,
  loading = false,
  ...response
}: {
  compareSeries?: CompareSeries[];
  colorsByQuery?: Record<string, string>;
  primaryQuery?: string;
  compareBarPrimaryQuery?: string;
  [key: string]: any;
}) {
  const compareIssue = inspectComparePayloads([response, ...compareSeries.map(series => series.response)]);
  const model = useMemo(() => {
    if (isEmpty(response)) return null;
    const data_meta: Array<DataMeta> = [];
    let chem_key_column = "";
    let specie_key_column = "";
    let chemical_count_key = "";
    let species_count_key = "";

    const metadata = [...response["metadata"]].sort(
      (
        meta_1: { [index: string]: any },
        meta_2: { [index: string]: any },
      ) => {
        return compareMetadataResultTypes(meta_1["type"], meta_2["type"]);
      },
    );
    metadata.forEach((meta_item: { [index: string]: any }) => {
      const data_name = meta_item["column"];
      let data_type = "";
      let additional_data = "";
      let classificationLevel: number | null = null;
      let classificationTag: string | null = null;

      const full_type = meta_item["type"];
      const linkModifier = getMetadataTypeModifier(full_type, "link");
      const classificationModifier = getMetadataTypeModifier(full_type, "clas");
      const externalSheet = getMetadataTypeModifier(full_type, "external")?.[0];
      if (linkModifier) {
        data_type = "link";
        additional_data = linkModifier[0];
      } else if (classificationModifier) {
        data_type = "clas";
      } else if (hasMetadataTypeToken(full_type, "SMILES")) {
        data_type = "smiles";
      } else if (hasMetadataTypeToken(full_type, "ref[]")) {
        data_type = "reference";
      }
      if (classificationModifier && /^\d+$/.test(classificationModifier[0])) {
        classificationLevel = Number(classificationModifier[0]);
        classificationTag = classificationModifier[1] === undefined || classificationModifier[1] === "default" || classificationModifier[1] === "original" ? "original" : classificationModifier[1];
      }

      const entityKind = hasMetadataTypeToken(full_type, "chemical") || externalSheet === "structures"
        ? "chemical" as const
        : hasMetadataTypeToken(full_type, "specie") || classificationModifier || externalSheet === "classification"
          ? "specie" as const
          : "";
      if (hasMetadataTypeToken(full_type, "keycolumn")) {
        if (entityKind === "chemical") chem_key_column = data_name;
        if (entityKind === "specie") specie_key_column = data_name;
      }
      if (meta_item["entity_count_key"] === "chemical") chemical_count_key = data_name;
      if (meta_item["entity_count_key"] === "species") species_count_key = data_name;

      let group_type = "";
      if (entityKind === "chemical") {
        group_type = "chemical";
      } else if (entityKind === "specie") {
        group_type = "specie";
      }
      // Result placement is opt-in. Classification still carries its rank and
      // source metadata when selected, but must not leak every taxonomy column
      // into result-side entity panels merely because it is classification.
      if (!hasMetadataTypeToken(full_type, "table_")) {
        group_type = "ignore";
      }
      data_meta.push(
        new DataMeta(
          data_type,
          data_name,
          meta_item["name"],
          meta_item["description"],
          additional_data,
          group_type,
          {
            isListName: hasMetadataTypeToken(full_type, "list_name"),
            classificationLevel, classificationTag,
            showOnChemicalPage: hasMetadataTypeToken(full_type, "chemical_page"),
            showOnSpeciesPage: hasMetadataTypeToken(full_type, "species_page"),
            isPrimary: hasMetadataTypeToken(full_type, "primary"),
            isKeyColumn: hasMetadataTypeToken(full_type, "keycolumn"),
            entityKind,
          },
        ),
      );
    });

    return {
      meta: data_meta,
      chemKey: chem_key_column,
      specieKey: specie_key_column,
      chemicalCountKey: chemical_count_key || chem_key_column,
      speciesCountKey: species_count_key || specie_key_column,
    };
  }, [response.metadata]);
  const rows = useMemo(() => model
    ? rowsFromResponseData(
      response.data,
      model.meta,
      model.chemKey,
      model.specieKey,
      model.chemicalCountKey,
      model.speciesCountKey,
    )
    : [], [response.data, model]);
  const grouping = useMemo(() => model ? groupingFromResponses(
    [response, ...compareSeries.map(series => series.response)],
    model.chemicalCountKey, model.chemKey, model.speciesCountKey, model.specieKey,
  ) : null, [response.entity_groups, compareSeries, model]);

  if (compareIssue) return <p className="empty-state" role="alert">{compareIssue} Clear the API cache and reload this page.</p>;
  if (!model || !grouping) return <div></div>;

  return (
    <ResultTableWrapper
      rows={rows}
      meta={model.meta}
      chemKey={model.chemKey}
      specieKey={model.specieKey}
      chemicalCountKey={model.chemicalCountKey}
      speciesCountKey={model.speciesCountKey}
      compareSeries={compareSeries}
      colorsByQuery={colorsByQuery}
      primaryQuery={primaryQuery}
      compareBarPrimaryQuery={compareBarPrimaryQuery}
      loading={loading}
      grouping={grouping}
    />
  );
}

export default ResultTableOrNull;
