import { useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { api } from "../shared/api";
import { EntityDetailTable } from "../SearchApp/EntityDetailTable";
import { fetchEntityPageDetails, sourceEntityPageDetails, type MetadataResponse, type SearchResponse, type SourceEntityRecord } from "../SearchApp/entityPageDetails";
import DataMeta from "../SearchApp/DataMeta";

function resolveSmiles(
  smilesParam: string | undefined,
  searchParams: URLSearchParams,
): string | null {
  const fromQuery = searchParams.get("smiles");
  if (fromQuery != null && fromQuery !== "") {
    return fromQuery;
  }
  if (smilesParam != null && smilesParam !== "") {
    try {
      return decodeURIComponent(smilesParam);
    } catch {
      return smilesParam;
    }
  }
  return null;
}

function smilesCanvasId(smiles: string): string {
  let hash = 0;
  for (let i = 0; i < smiles.length; i++) {
    hash = (hash * 31 + smiles.charCodeAt(i)) | 0;
  }
  return `smiles_${Math.abs(hash).toString(36)}`;
}

function sourceSmiles(source: SourceEntityRecord | null): string | null {
  const column = source?.columns.find(item => /(?:^|\s)SMILES(?:\s|$)/.test(item.type));
  if (!column) return null;
  return String(source!.item[column.column] ?? "").trim() || null;
}

export function ChemicalPageView({ smiles, details, children, maxWidth = "800px", renderDetailLabel }: { smiles: string; details: { meta: DataMeta[]; row: Map<string, string> } | null; children: ReactNode; maxWidth?: string | number; renderDetailLabel?: (column: DataMeta) => ReactNode }) {
  return <div style={{ padding: "24px", maxWidth, margin: "0 auto" }}>
    <div key={smiles} style={{ marginBottom: "24px" }}><canvas id={smilesCanvasId(smiles)} className="smiles" data-smiles={smiles} /></div>
    <div style={{ marginBottom: "8px", color: "var(--color-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "14px" }}>SMILES: {smiles}</div>
    {details && <aside aria-label="Chemical details" style={{ float: "right", width: "min(340px, 40%)", margin: "0 0 16px 24px" }}><EntityDetailTable meta={details.meta.filter(column => column.type !== "smiles")} row={details.row} hideEmpty renderLabel={renderDetailLabel} /></aside>}
    {children}
  </div>;
}

export default function SubstancePage() {
  const { smiles: smilesEncoded, id } = useParams<{ smiles: string; id: string }>();
  const [searchParams] = useSearchParams();
  const legacySmiles = resolveSmiles(smilesEncoded, searchParams);
  const [source, setSource] = useState<SourceEntityRecord | null>(null);
  const [sourceLoaded, setSourceLoaded] = useState(!id);
  const smiles = id ? sourceSmiles(source) : legacySmiles;

  const state = useEditablePage(id ? `chemical:${id}` : smiles, "", id ? smiles : null);
  const [details, setDetails] = useState<{ meta: DataMeta[]; row: Map<string, string> } | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setSource(null);
    setSourceLoaded(false);
    void api.get<SourceEntityRecord>(`/catalog/chemicals/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(response => setSource(response.data))
      .catch(() => setSource(null))
      .finally(() => { if (!controller.signal.aborted) setSourceLoaded(true); });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    setDetails(null);
    if (!smiles) return;
    let current = true;
    const controller = new AbortController();
    // Entity pages must follow the currently active dataset immediately. Their
    // metadata and detail projections are deliberately not served from a
    // browser cache left behind by a previous table activation.
    void api.get<MetadataResponse>("/metadata", { signal: controller.signal, params: { entity_page: Date.now() } }).then(async ({ data }) => {
      const smilesColumn = data.metadata.find(column => /(?:^|\s)SMILES(?:\s|$)/.test(column.type))?.column;
      if (!smilesColumn) return null;
      const joined = await fetchEntityPageDetails(data, "chemical", smilesColumn, smiles, controller.signal, async (params, signal) => (await api.get<SearchResponse>("/search", { params: { ...params, entity_page: data.timestamp }, signal })).data);
      if (joined || controller.signal.aborted) return joined;
      if (source) return sourceEntityPageDetails(source, "chemical");
      const record = await api.get<SourceEntityRecord>("/catalog/chemicals/record", { params: { column: smilesColumn, value: smiles }, signal: controller.signal });
      return sourceEntityPageDetails(record.data, "chemical");
    }).then(value => { if (current) setDetails(value); }).catch(() => { if (current) setDetails(null); });
    return () => { current = false; controller.abort(); };
  }, [smiles, source]);

  if (id && !sourceLoaded) return <><FullNavigation /><div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>Loading…</div></>;
  if (smiles === null || smiles === "") {
    return (
      <>
        <FullNavigation />
        <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
          <p className="empty-state">Invalid page.</p>
        </div>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <FullNavigation />
        <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
          Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <FullNavigation />
      <ChemicalPageView smiles={smiles} details={details} maxWidth={state.editMode ? "1400px" : "800px"}>
        <EditablePageContent
          content={state.content}
          error={state.error}
          editMode={state.editMode}
          setEditMode={state.setEditMode}
          editText={state.editText}
          setEditText={state.setEditText}
          saving={state.saving}
          handleSave={state.handleSave}
          charCount={state.charCount}
          overLimit={state.overLimit}
        />
      </ChemicalPageView>
    </>
  );
}
