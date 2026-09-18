import { useState, type ReactNode } from "react";
import DataMeta from "./DataMeta";
import { InfoTip } from "../shared/ui/InfoTip";

export function classificationRowsForSource(columns: DataMeta[], source: string): DataMeta[] {
  const ranks = [...new Set(columns.map(column => column.classification_level).filter((rank): rank is number => rank !== null))];
  return ranks.flatMap(rank => {
    const variants = columns.filter(column => column.classification_level === rank);
    const selected = variants.filter(column => (column.classification_tag ?? "original") === source);
    if (selected.length) return selected;
    const original = variants.filter(column => (column.classification_tag ?? "original") === "original");
    return original.length ? original : variants.filter(column => (column.classification_tag ?? "original") === variants[0]?.classification_tag);
  });
}

export function EntityDetailTable({ meta, row, hideEmpty = false, renderLabel }: { meta: DataMeta[]; row: Map<string, string>; hideEmpty?: boolean; renderLabel?: (column: DataMeta) => ReactNode }) {
  let markedInfo = false;
  const visible = (hideEmpty ? meta.filter(column => column.classification_level !== null || (row.get(column.name) ?? "").trim() !== "") : meta).slice().sort((left, right) => {
    if (left.classification_level !== null && right.classification_level !== null) return right.classification_level - left.classification_level;
    if (left.classification_level !== null) return -1;
    if (right.classification_level !== null) return 1;
    return 0;
  });
  const classification = visible.filter(column => column.classification_level !== null);
  const sources = [...new Set(classification.map(column => column.classification_tag ?? "original"))];
  const [classificationSource, setClassificationSource] = useState(sources.includes("original") ? "original" : sources[0] ?? "original");
  const effectiveSource = sources.includes(classificationSource) ? classificationSource : sources.includes("original") ? "original" : sources[0] ?? "original";
  const selectedClassification = classificationRowsForSource(classification, effectiveSource);
  const renderRow = (column: DataMeta) => {
    const tipTour = !markedInfo && column.description?.trim() ? ((markedInfo = true), "table-detail-info") : undefined;
    return <tr key={column.name}><td style={{ width: "42%", wordBreak: "break-word" }}><InfoTip text={column.description} dataTour={tipTour} />&nbsp;{renderLabel ? renderLabel(column) : column.show_name}</td><td style={{ width: "58%", wordBreak: "break-word" }}>{column.render(row.get(column.name))}</td></tr>;
  };
  const rows = [...selectedClassification, ...visible.filter(column => column.classification_level === null)].map(column => renderRow(column));
  return <>{sources.length > 1 && <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", marginBottom: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface-alt)", fontSize: "0.9rem" }}><span style={{ fontWeight: 600 }}>Classification source</span><select aria-label="Classification source" value={effectiveSource} onChange={event => setClassificationSource(event.target.value)} style={{ minWidth: 112, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", padding: "4px 6px" }}>
    {sources.map(source => <option key={source} value={source}>{source === "original" ? "Original" : source}</option>)}
  </select></label>}<table style={{ width: "100%", tableLayout: "fixed" }}><tbody>{rows}</tbody></table></>;
}
