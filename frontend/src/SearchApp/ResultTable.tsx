import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileArrowUp,
  ArrowUpRightFromSquare,
  Molecule,
  BranchesRight,
  BookOpen,
  Xmark,
} from "@gravity-ui/icons";
import { isEmpty } from "../shared/api";
import { Container, ScrollableContainer } from "../shared/ui";
import config from "../config";
import DataMeta from "./DataMeta";
import DataRows from "./RowsData";
import { type CountMode } from "./PhylogeneticTree";
import { InfoTip } from "../shared/ui/InfoTip";
import { substancePagePath } from "../shared/substanceUrl";
import { QueryCompareBar, type CompareSeries } from "./QueryCompareBar";
import { CitationPopover } from "../shared/ui/CitationPopover";
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

function countLabelForSpecie(
  rows: DataRows[],
  specie: string,
  mode: CountMode,
  refColumns: string[],
): number {
  const subset = rows.filter((dr) => dr.specie_val === specie);
  if (mode === "chemicals") {
    return new Set(subset.map((dr) => dr.chemical_val)).size;
  }
  if (mode === "articles") {
    return uniqueArticleCountInRows(subset, refColumns);
  }
  return subset.reduce((acc, dr) => acc + dr.total_length, 0);
}

function countLabelForChemical(
  rows: DataRows[],
  chemical: string,
  mode: CountMode,
  refColumns: string[],
): number {
  const subset = rows.filter((dr) => dr.chemical_val === chemical);
  if (mode === "chemicals") {
    // counterpart entities: species linked to this chemical
    return new Set(subset.map((dr) => dr.specie_val)).size;
  }
  if (mode === "articles") {
    return uniqueArticleCountInRows(subset, refColumns);
  }
  return subset.reduce((acc, dr) => acc + dr.total_length, 0);
}

type SelectOption = {
  value: string;
  count: number;
  seriesCounts?: Array<{ color: string; n: number }>;
};

function filterRows(
  rows: DataRows[],
  specie: string,
  chemical: string,
): DataRows[] {
  return rows.filter(
    (dr) =>
      (specie === "" || dr.specie_val === specie) &&
      (chemical === "" || dr.chemical_val === chemical),
  );
}

function buildOptions(
  rows: DataRows[],
  kind: "specie" | "chemical",
  mode: CountMode,
  refColumns: string[],
): SelectOption[] {
  const values: string[] = [];
  const seen = new Set<string>();
  rows.forEach((dr) => {
    const v = kind === "specie" ? dr.specie_val : dr.chemical_val;
    if (!seen.has(v)) {
      seen.add(v);
      values.push(v);
    }
  });
  return values
    .map((value) => ({
      value,
      count:
        kind === "specie"
          ? countLabelForSpecie(rows, value, mode, refColumns)
          : countLabelForChemical(rows, value, mode, refColumns),
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Union of values across all compare series; sort by sum of per-query counts. */
function buildOptionsWithSeries(
  primaryRows: DataRows[],
  kind: "specie" | "chemical",
  mode: CountMode,
  refColumns: string[],
  series: Array<{ color: string; rows: DataRows[] | "primary" }>,
): SelectOption[] {
  if (series.length <= 1) {
    return buildOptions(primaryRows, kind, mode, refColumns);
  }
  const resolved = series.map(({ color, rows: srows }) => ({
    color,
    rows: srows === "primary" ? primaryRows : srows,
  }));
  const values = new Set<string>();
  resolved.forEach(({ rows }) => {
    rows.forEach((dr) => {
      values.add(kind === "specie" ? dr.specie_val : dr.chemical_val);
    });
  });
  return Array.from(values)
    .map((value) => {
      const seriesCounts = resolved.map(({ color, rows }) => ({
        color,
        n:
          kind === "specie"
            ? countLabelForSpecie(rows, value, mode, refColumns)
            : countLabelForChemical(rows, value, mode, refColumns),
      }));
      return {
        value,
        count: seriesCounts.reduce((acc, s) => acc + s.n, 0),
        seriesCounts,
      };
    })
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Build DataRows from raw search rows using already-parsed meta + key columns. */
function rowsFromResponseData(
  dataItems: Array<{ [index: string]: any }>,
  meta: DataMeta[],
  chemKey: string,
  specieKey: string,
): DataRows[] {
  const map = new Map<string, DataRows>();

  dataItems.forEach((data_item) => {
    const chem_row = new Map<string, string>();
    const specie_row = new Map<string, string>();
    const value_row = new Map<string, string>();
    meta.forEach((m) => {
      const item = data_item[m.name] != null ? String(data_item[m.name]) : "";
      // SMILES is often typed without `table_`, so is_chemical is false — still attach to chem.
      if (m.is_chemical || m.type === "smiles") chem_row.set(m.name, item);
      else if (m.is_specie) specie_row.set(m.name, item);
      else value_row.set(m.name, item);
    });
    const chem_key_str = [...chem_row.values()].sort().join("");
    const specie_key_str = [...specie_row.values()].sort().join("");
    const key = chem_key_str + specie_key_str;
    if (!map.has(key)) {
      map.set(
        key,
        new DataRows(specie_row, specieKey, chem_row, chemKey, []),
      );
    }
    map.get(key)?.add_row(value_row);
  });
  return [...map.values()];
}

type SeriesRowSet = { color: string; rows: DataRows[] };

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

function mergeValueRowsFromSeries(
  filteredBySeries: SeriesRowSet[],
  refColumns: string[],
): Array<Map<string, string>> {
  const seen = new Set<string>();
  const out: Array<Map<string, string>> = [];
  filteredBySeries.forEach(({ rows }) => {
    rows.forEach((dr) => {
      dr.value_rows.forEach((row) => {
        const refKey = refColumns.map((c) => row.get(c) ?? "").join("\0");
        const key =
          refKey.replace(/\0/g, "") !== ""
            ? `ref:${refKey}`
            : `row:${[...row.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}=${v}`)
                .join("\0")}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(row);
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
): Map<string, string> | null {
  if (!chemical) return null;
  let fallback: Map<string, string> | null = null;
  const pools = [primaryRows, ...seriesSets.map((s) => s.rows)];
  for (const rows of pools) {
    for (const dr of rows) {
      if (dr.chemical_val !== chemical) continue;
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
): Map<string, string> | null {
  if (!specie) return null;
  for (const dr of primaryRows) {
    if (dr.specie_val === specie) return dr.specie_row;
  }
  for (const { rows } of seriesSets) {
    const found = rows.find((dr) => dr.specie_val === specie);
    if (found) return found.specie_row;
  }
  return null;
}

/** SMILES keyed by chemical name across every compare series (no specie filter). */
function buildChemicalSmilesMap(
  primaryRows: DataRows[],
  seriesSets: SeriesRowSet[],
  smilesKey: string,
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
      if (!smiles) return;
      if (!map.has(dr.chemical_val) || map.get(dr.chemical_val) === "") {
        map.set(dr.chemical_val, smiles);
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
  rows: Array<Map<string, string>>;
  meta: Array<DataMeta>;
  articleSeriesColors?: Map<string, string[]>;
}) {
  return (
    <tbody>
      {rows.map((row, rowIdx) => (
        <tr key={rowIdx}>
          {meta.map((meta_val, ind) => {
            if (meta_val.is_grouping || meta_val.is_ignore) {
              return <></>;
            }
            const isRef = meta_val.type === "reference";
            const raw = row.get(meta_val.name);
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
  rows: Array<Map<string, string>>;
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

function RankedSelectList({
  options,
  countModeLabel,
  onSelect,
  onHover,
}: {
  options: SelectOption[];
  countModeLabel: string;
  onSelect: (value: string) => void;
  onHover?: (value: string | null) => void;
}) {
  if (options.length === 0) {
    return <p className="empty-state" style={{ padding: 12 }}>No items</p>;
  }
  return (
    <ol
      className="ranked-select-list"
      onMouseLeave={() => onHover?.(null)}
    >
      {options.map((opt, i) => (
        <li key={opt.value}>
          <button
            type="button"
            className="ranked-select-list__item"
            onClick={() => onSelect(opt.value)}
            onMouseEnter={() => onHover?.(opt.value)}
            onFocus={() => onHover?.(opt.value)}
            onBlur={() => onHover?.(null)}
          >
            <span className="ranked-select-list__index">{i + 1}.</span>
            <span className="ranked-select-list__value">{opt.value}</span>
            <span className="ranked-select-list__count">
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
                    {countModeLabel}: {opt.count}
                  </>
                );
              })()}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function DetailAttributeTable({
  meta,
  row,
  kind,
}: {
  meta: DataMeta[];
  row: Map<string, string>;
  kind: "chemical" | "specie";
}) {
  return (
    <table style={{ width: "100%", tableLayout: "fixed" }}>
      <tbody>
        {meta.map((meta_val, ind) => {
          if (kind === "chemical") {
            if (!meta_val.is_chemical || meta_val.type === "smiles") return null;
          } else if (!meta_val.is_specie) {
            return null;
          }
          return (
            <tr key={meta_val.name}>
              <td style={{ width: "42%", wordBreak: "break-word" }}>
                <InfoTip text={meta_val.description} />
                &nbsp;{meta_val.show_name}
              </td>
              <td style={{ width: "58%", wordBreak: "break-word" }}>
                {meta[ind].render(row.get(meta_val.name))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
}) {
  const BadgeIcon = kind === "chemical" ? Molecule : BranchesRight;
  const badgeClass =
    kind === "chemical" ? "badge badge-chemical" : "badge badge-species";

  return (
    <Container
      maxHeight="520px"
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
        />
      ) : detailRow ? (
        <>
          {smilesLink != null && smilesLink !== "" && (
            <p style={{ textAlign: "center", marginTop: 8, marginBottom: 12 }}>
              <Link
                to={substancePagePath(smilesLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="link-button"
              >
                Open substance page
                <ArrowUpRightFromSquare />
              </Link>
            </p>
          )}
          <DetailAttributeTable meta={meta} row={detailRow} kind={kind} />
        </>
      ) : null}
    </Container>
  );
}

function smilesLookup(
  rows: DataRows[],
  smilesKey: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!smilesKey) return map;
  rows.forEach((dr) => {
    if (map.has(dr.chemical_val)) return;
    map.set(dr.chemical_val, dr.chemical_row.get(smilesKey) ?? "");
  });
  return map;
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
  compareSeries = [],
}: {
  rows: DataRows[];
  meta: DataMeta[];
  currentSpecie: string;
  setCurrentSpecie: (v: string) => void;
  currentChemical: string;
  setCurrentChemical: (v: string) => void;
  countMode: CountMode;
  refColumns: string[];
  compareSeries?: CompareSeries[];
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
      : rows.filter((dr) => dr.chemical_val === previewChemical);
  const rowsForChemicalList =
    previewSpecie === ""
      ? rows
      : rows.filter((dr) => dr.specie_val === previewSpecie);

  const speciesCountMode: CountMode =
    hoveredChemical !== "" ? "articles" : countMode;
  const chemicalsCountMode: CountMode =
    hoveredSpecie !== "" ? "articles" : countMode;

  const seriesRowSets = useMemo(() => {
    if (compareSeries.length <= 1) {
      return [] as Array<{ color: string; rows: DataRows[] | "primary" }>;
    }
    const chemKey = rows[0]?.chemical_key ?? "";
    const specieKey = rows[0]?.specie_key ?? "";
    return compareSeries.map((s, i) => ({
      color: s.color,
      rows:
        i === 0
          ? ("primary" as const)
          : rowsFromResponseData(
              s.response["data"] ?? [],
              meta,
              chemKey,
              specieKey,
            ),
    }));
  }, [compareSeries, meta, rows]);

  const speciesOptions = buildOptionsWithSeries(
    rowsForSpeciesList,
    "specie",
    speciesCountMode,
    refColumns,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : previewChemical === ""
            ? srows
            : srows.filter((dr) => dr.chemical_val === previewChemical),
    })),
  );
  const chemicalsOptions = buildOptionsWithSeries(
    rowsForChemicalList,
    "chemical",
    chemicalsCountMode,
    refColumns,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : previewSpecie === ""
            ? srows
            : srows.filter((dr) => dr.specie_val === previewSpecie),
    })),
  );
  const chemicalSmiles = buildChemicalSmilesMap(
    rows,
    resolveCompareRowSets(rows, seriesRowSets),
    smilesKey,
  );

  // Selection validity uses committed filters only — hover must not clear picks.
  // Include values from all compare series (union), not only the primary query.
  const selectedSpeciesValuesKey = buildOptionsWithSeries(
    currentChemical === ""
      ? rows
      : rows.filter((dr) => dr.chemical_val === currentChemical),
    "specie",
    countMode,
    refColumns,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : currentChemical === ""
            ? srows
            : srows.filter((dr) => dr.chemical_val === currentChemical),
    })),
  )
    .map((o) => o.value)
    .join("\0");
  const selectedChemicalsValuesKey = buildOptionsWithSeries(
    currentSpecie === ""
      ? rows
      : rows.filter((dr) => dr.specie_val === currentSpecie),
    "chemical",
    countMode,
    refColumns,
    seriesRowSets.map(({ color, rows: srows }) => ({
      color,
      rows:
        srows === "primary"
          ? "primary"
          : currentSpecie === ""
            ? srows
            : srows.filter((dr) => dr.specie_val === currentSpecie),
    })),
  )
    .map((o) => o.value)
    .join("\0");

  useEffect(() => {
    if (
      currentSpecie !== "" &&
      !selectedSpeciesValuesKey.split("\0").includes(currentSpecie)
    ) {
      setCurrentSpecie("");
    }
  }, [currentSpecie, selectedSpeciesValuesKey, setCurrentSpecie]);

  useEffect(() => {
    if (
      currentChemical !== "" &&
      !selectedChemicalsValuesKey.split("\0").includes(currentChemical)
    ) {
      setCurrentChemical("");
    }
  }, [currentChemical, selectedChemicalsValuesKey, setCurrentChemical]);

  const resolvedSeries = resolveCompareRowSets(rows, seriesRowSets);
  const previewFilteredBySeries = resolvedSeries.map(({ color, rows: srows }) => ({
    color,
    rows: filterRows(srows, previewSpecie, previewChemical),
  }));
  const valueRows = mergeValueRowsFromSeries(previewFilteredBySeries, refColumns);
  const articleSeriesColors =
    seriesRowSets.length > 1
      ? collectArticleSeriesColors(previewFilteredBySeries, refColumns)
      : undefined;
  const referenceCount = uniqueArticleCountInRows(
    flattenFilteredDataRows(previewFilteredBySeries),
    refColumns,
  );

  const chemicalDetail = findChemicalRow(
    rows,
    resolvedSeries,
    currentChemical,
    smilesKey,
  );
  const specieDetail = findSpecieRow(rows, resolvedSeries, currentSpecie);

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
    speciesCountMode === "chemicals" ? "chemicals" : speciesCountMode;
  const chemicalCountLabel =
    chemicalsCountMode === "chemicals" ? "species" : chemicalsCountMode;

  const showPublications =
    currentSpecie !== "" ||
    currentChemical !== "" ||
    hoveredChemical !== "" ||
    hoveredSpecie !== "";

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
        title="Chemical"
        listCount={currentChemical === "" ? chemicalsOptions.length : 1}
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
        meta={meta}
        smilesLink={
          selectedSmiles ||
          (currentChemical !== ""
            ? chemicalSmiles.get(currentChemical) ?? ""
            : "")
        }
      />

      <div
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
        listCount={currentSpecie === "" ? speciesOptions.length : 1}
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
        meta={meta}
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
  colorsByQuery = {},
}: {
  rows: DataRows[];
  downloadSheets: DownloadSheet[];
  meta: DataMeta[];
  currentSpecie: string;
  currentChemical: string;
  countMode: CountMode;
  setCountMode: React.Dispatch<React.SetStateAction<CountMode>>;
  countModeLocked: boolean;
  speciesCount: number;
  chemicalCount: number;
  referenceCount: number;
  primaryQuery?: string;
  colorsByQuery?: Record<string, string>;
}) {
  let total_rows = 0;
  rows.forEach((data_rows) => {
    if (currentChemical !== "" && data_rows.chemical_val !== currentChemical) {
      return;
    }
    if (currentSpecie !== "" && data_rows.specie_val !== currentSpecie) {
      return;
    }
    total_rows += data_rows.total_length;
  });

  const displayMode: CountMode = countModeLocked ? "articles" : countMode;

  return (
    <div className="panel panel-toolbar">
      <div className="count-mode-block">
        <div className="count-mode-block__row">
          <span>Count in lists: </span>
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
              {filterCountMode(mode, "chemicals", "chemicals / species")}
            </button>
          ))}
        </div>
        <p className="count-mode-block__hint" aria-hidden={!countModeLocked}>
          {countModeLocked ? "(by articles while an item is selected)" : "\u00A0"}
        </p>
      </div>

      <div className="panel-toolbar__compare">
        <QueryCompareBar
          primaryQuery={primaryQuery}
          colorsByQuery={colorsByQuery}
        />
      </div>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        Download results:
        <button
          type="button"
          className="btn"
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
        Chemical ({chemicalCount})
      </span>
      <span className="badge badge-species" style={{ fontSize: "0.85rem" }}>
        <BranchesRight width={14} height={14} aria-hidden />
        Species ({speciesCount})
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
  compareSeries = [],
  colorsByQuery = {},
  primaryQuery = "",
}: {
  rows: Array<DataRows>;
  meta: Array<DataMeta>;
  compareSeries?: CompareSeries[];
  colorsByQuery?: Record<string, string>;
  primaryQuery?: string;
}) {
  if (rows.length === 0) {
    return <></>;
  }

  const refColumns = meta
    .filter((m) => m.type === "reference")
    .map((m) => m.name);

  const allSpecies = buildOptions(rows, "specie", "chemicals", refColumns);
  const allChemicals = buildOptions(rows, "chemical", "chemicals", refColumns);

  const [countMode, setCountMode] = useState<CountMode>("chemicals");
  const [currentSpecie, setCurrentSpecie] = useState(
    allSpecies.length === 1 ? allSpecies[0].value : "",
  );
  const [currentChemical, setCurrentChemical] = useState(
    allChemicals.length === 1 ? allChemicals[0].value : "",
  );

  const countModeLocked = currentSpecie !== "" || currentChemical !== "";
  const effectiveCountMode: CountMode = countModeLocked ? "articles" : countMode;

  const chemKey = rows[0]?.chemical_key ?? "";
  const specieKey = rows[0]?.specie_key ?? "";
  const seriesRowSets =
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
                ),
        }))
      : [];
  const resolvedSeries = resolveCompareRowSets(rows, seriesRowSets);

  const filteredBySeries = resolvedSeries.map(({ color, rows: srows }) => ({
    color,
    rows: filterRows(srows, currentSpecie, currentChemical),
  }));
  const rowsForSpeciesListBySeries = resolvedSeries.map(
    ({ color, rows: srows }) => ({
      color,
      rows:
        currentChemical === ""
          ? srows
          : srows.filter((dr) => dr.chemical_val === currentChemical),
    }),
  );
  const rowsForChemicalListBySeries = resolvedSeries.map(
    ({ color, rows: srows }) => ({
      color,
      rows:
        currentSpecie === ""
          ? srows
          : srows.filter((dr) => dr.specie_val === currentSpecie),
    }),
  );

  const speciesCount =
    currentSpecie === ""
      ? buildOptionsWithSeries(
          rowsForSpeciesListBySeries[0]?.rows ?? rows,
          "specie",
          effectiveCountMode,
          refColumns,
          seriesRowSets.map(({ color, rows: srows }, i) => ({
            color,
            rows:
              srows === "primary"
                ? "primary"
                : rowsForSpeciesListBySeries[i]?.rows ?? srows,
          })),
        ).length
      : 1;
  const chemicalCount =
    currentChemical === ""
      ? buildOptionsWithSeries(
          rowsForChemicalListBySeries[0]?.rows ?? rows,
          "chemical",
          effectiveCountMode,
          refColumns,
          seriesRowSets.map(({ color, rows: srows }, i) => ({
            color,
            rows:
              srows === "primary"
                ? "primary"
                : rowsForChemicalListBySeries[i]?.rows ?? srows,
          })),
        ).length
      : 1;
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
        const srows =
          i === 0
            ? rows
            : rowsFromResponseData(
                s.response["data"] ?? [],
                meta,
                chemKey,
                specieKey,
              );
        return {
          query: s.query,
          color: s.color,
          fetchedAt: s.fetchedAt,
          rows: filterRows(srows, currentSpecie, currentChemical),
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
        rows: filterRows(rows, currentSpecie, currentChemical),
      },
    ];
  })();

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
        colorsByQuery={colorsByQuery}
      />
      <ResultsWorkspace
        rows={rows}
        meta={meta}
        currentSpecie={currentSpecie}
        setCurrentSpecie={setCurrentSpecie}
        currentChemical={currentChemical}
        setCurrentChemical={setCurrentChemical}
        countMode={effectiveCountMode}
        refColumns={refColumns}
        compareSeries={compareSeries}
      />
    </>
  );
}

function ResultTableOrNull({
  compareSeries = [],
  colorsByQuery = {},
  primaryQuery = "",
  ...response
}: {
  compareSeries?: CompareSeries[];
  colorsByQuery?: Record<string, string>;
  primaryQuery?: string;
  [key: string]: any;
}) {
  if (isEmpty(response)) {
    return <div></div>;
  }

  const data_meta: Array<DataMeta> = [];
  const data = new Map<string, DataRows>();
  const group_chem_inds = new Set<number>();
  let chem_key_column = "";
  const group_specie_inds = new Set<number>();
  let specie_key_column = "";

  const metadata = response["metadata"].sort(
    (
      meta_1: { [index: string]: any },
      meta_2: { [index: string]: any },
    ) => {
      if (meta_1["type"] > meta_2["type"]) {
        return 1;
      }
      return -1;
    },
  );
  metadata.forEach((meta_item: { [index: string]: any }) => {
    const data_name = meta_item["column"];
    let data_type = "";
    let additional_data = "";

    const full_type = meta_item["type"];
    if (full_type.includes("link")) {
      data_type = "link";
      additional_data = full_type.split("link[")[1].split("]")[0];
    } else if (full_type.includes("clas")) {
      data_type = "clas";
    } else if (full_type.includes("SMILES")) {
      data_type = "smiles";
    } else if (full_type.includes("ref[]")) {
      data_type = "reference";
    }

    if (full_type.includes("chemical")) {
      group_chem_inds.add(data_meta.length);
      if (full_type.includes("keycolumn")) {
        chem_key_column = data_name;
      }
    } else if (full_type.includes("specie")) {
      group_specie_inds.add(data_meta.length);
      if (full_type.includes("keycolumn")) {
        specie_key_column = data_name;
      }
    }

    let group_type = "";
    if (full_type.includes("chemical")) {
      group_type = "chemical";
    } else if (full_type.includes("specie")) {
      group_type = "specie";
    }
    if (!full_type.includes("table_")) {
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
      ),
    );
  });

  response["data"].forEach((data_item: { [index: string]: any }) => {
    const row = new Map<string, string>();
    const group_chem_row = new Map<string, string>();
    const group_specie_row = new Map<string, string>();

    data_meta.forEach((meta_item: DataMeta, ind) => {
      const item = data_item[meta_item.name] ? data_item[meta_item.name] : "";
      if (group_chem_inds.has(ind)) {
        group_chem_row.set(meta_item.name, item);
      } else if (group_specie_inds.has(ind)) {
        group_specie_row.set(meta_item.name, item);
      } else {
        row.set(meta_item.name, item);
      }
    });

    const chem_key: string[] = [];
    group_chem_row.forEach((val) => {
      chem_key.push(val);
    });
    const chem_key_str = chem_key.sort().join("");

    const specie_key: string[] = [];
    group_specie_row.forEach((val) => {
      specie_key.push(val);
    });
    const specie_key_str = specie_key.sort().join("");

    const key = chem_key_str + specie_key_str;

    if (!data.has(key)) {
      data.set(
        key,
        new DataRows(
          group_specie_row,
          specie_key_column,
          group_chem_row,
          chem_key_column,
          [],
        ),
      );
    }
    data.get(key)?.add_row(row);
  });

  const rows: Array<DataRows> = [];
  data.forEach((val) => {
    rows.push(val);
  });

  return (
    <ResultTableWrapper
      rows={rows}
      meta={data_meta}
      compareSeries={compareSeries}
      colorsByQuery={colorsByQuery}
      primaryQuery={primaryQuery}
    />
  );
}

export default ResultTableOrNull;
