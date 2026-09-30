import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { api } from "../shared/api";
import { EntityDetailTable } from "../SearchApp/EntityDetailTable";
import { fetchEntityPageDetails, sourceEntityPageDetails, type MetadataResponse, type SearchResponse, type SourceEntityRecord } from "../SearchApp/entityPageDetails";
import DataMeta from "../SearchApp/DataMeta";
import { MoleculePreview } from "../SearchApp/MoleculePreview";
import { hasMetadataTypeToken } from "../shared/metadataType";
import "./SubstancePage.css";

type ChemicalFamily = {
  timestamp: string;
  primary_column: string;
  count_column: string;
  group_value: string;
  species_count_column?: string;
  publication_columns?: string[];
  columns: MetadataResponse["metadata"];
  items: Array<{ id: string; item: Record<string, unknown>; species_count: number; publication_count: number; has_observations: boolean }>;
};

export function ChemicalFamilyPanel({ family }: { family: ChemicalFamily }) {
  const nameColumn = family.columns.find(column => hasMetadataTypeToken(column.type, "list_name")) ?? family.columns.find(column => column.column === "names" || column.column === "trivial_names");
  const smilesColumn = family.columns.find(column => hasMetadataTypeToken(column.type, "SMILES"));
  const foundMembers = family.items.filter(member => member.has_observations);
  return <details className="chemical-family">
    <summary title="Records with observations / stored family records">Stereoisomers · Found {foundMembers.length} of {family.items.length}</summary>
    <ul className="chemical-family__cards">
      {foundMembers.map(member => {
        const fullNames = nameColumn ? String(member.item[nameColumn.column] ?? "").trim() : "";
        const name = fullNames.split("=")[0].trim();
        const smiles = smilesColumn ? String(member.item[smilesColumn.column] ?? "").trim() : "";
        return <li key={member.id} className="chemical-family__card">
          <Link className="chemical-family__name" to={`/chemical/${encodeURIComponent(member.id)}`} title={fullNames || undefined}>{name || member.id}</Link>
          <small className="chemical-family__id">Source ID: {member.id}</small>
          {smiles ? <MoleculePreview smiles={smiles} size="large" /> : <div className="chemical-family__unavailable">Structure unavailable</div>}
          {(member.species_count > 0 || member.publication_count > 0) && <div className="chemical-family__counts">Species: {member.species_count} · Publications: {member.publication_count}</div>}
        </li>;
      })}
    </ul>
  </details>;
}

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
    {smiles ? <><div key={smiles} style={{ marginBottom: "24px" }}><canvas id={smilesCanvasId(smiles)} className="smiles" data-smiles={smiles} /></div>
    <div style={{ marginBottom: "8px", color: "var(--color-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "14px" }}>SMILES: {smiles}</div></> : <p>Structure unavailable for this source record.</p>}
    {details && <aside aria-label="Chemical details" style={{ float: "right", width: "min(340px, 40%)", margin: "0 0 16px 24px" }}><EntityDetailTable meta={details.meta.filter(column => column.type !== "smiles")} row={details.row} hideEmpty renderLabel={renderDetailLabel} /></aside>}
    {children}
  </div>;
}

export default function SubstancePage() {
  const { smiles: smilesEncoded, id } = useParams<{ smiles: string; id: string }>();
  const [searchParams] = useSearchParams();
  const legacySmiles = resolveSmiles(smilesEncoded, searchParams);
  const [sourceEntry, setSourceEntry] = useState<{ id: string; record: SourceEntityRecord | null; loaded: boolean } | null>(null);
  const source = sourceEntry && sourceEntry.id === id ? sourceEntry.record : null;
  const sourceLoaded = !id || (sourceEntry != null && sourceEntry.id === id && sourceEntry.loaded);
  const [familyEntry, setFamilyEntry] = useState<{ id: string; family: ChemicalFamily | null } | null>(null);
  const family = familyEntry && familyEntry.id === id ? familyEntry.family : null;
  const [familyStatus, setFamilyStatus] = useState<{ id: string; loading: boolean; error: boolean } | null>(null);
  const familyError = familyStatus != null && familyStatus.id === id && familyStatus.error;
  const familyLoading = Boolean(id && (familyStatus?.id !== id || familyStatus.loading));
  const smiles = id ? sourceSmiles(source) : legacySmiles;

  const state = useEditablePage(id ? `chemical:${id}` : smiles, "", id ? smiles : null);
  const [details, setDetails] = useState<{ meta: DataMeta[]; row: Map<string, string> } | null>(null);

  useEffect(() => {
    setFamilyEntry(null);
    if (id) setFamilyStatus({ id, loading: true, error: false });
    if (!id) return;
    const controller = new AbortController();
    setSourceEntry({ id, record: null, loaded: false });
    void api.get<ChemicalFamily>(`/catalog/chemicals/${encodeURIComponent(id)}/stereoisomers`, { signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return;
        const family = response.data;
        const selected = family.items.find(member => member.id === id);
        if (selected) {
          setFamilyEntry({ id, family });
          setSourceEntry({ id, record: { kind: "chemicals", columns: family.columns, item: selected.item }, loaded: true });
          return;
        }
        throw new Error("Selected source record is missing from its family");
      })
      .catch(async () => {
        if (controller.signal.aborted) return;
        setFamilyStatus({ id, loading: false, error: true });
        try {
          const record = await api.get<SourceEntityRecord>(`/catalog/chemicals/${encodeURIComponent(id)}`, { signal: controller.signal });
          if (!controller.signal.aborted) setSourceEntry({ id, record: record.data, loaded: true });
        } catch {
          if (!controller.signal.aborted) setSourceEntry({ id, record: null, loaded: true });
        }
      })
      .finally(() => { if (!controller.signal.aborted) setFamilyStatus(current => current?.id === id ? { ...current, loading: false } : current); });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    setDetails(null);
    if (id) {
      if (source) setDetails(sourceEntityPageDetails(source, "chemical"));
      return;
    }
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
  }, [id, smiles, source]);

  if (id && !sourceLoaded) return <><FullNavigation /><div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>Loading…</div></>;
  if (id && !source) return <><FullNavigation /><div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}><p className="empty-state">Chemical source record unavailable.</p></div></>;
  if (!id && (smiles === null || smiles === "")) {
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
      <ChemicalPageView smiles={smiles ?? ""} details={details} maxWidth={state.editMode ? "1400px" : "800px"}>
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
        {id && (familyLoading ? <p role="status">Loading source stereoisomers…</p> : familyError ? <p role="status">Source stereoisomers are unavailable.</p> : family && <ChemicalFamilyPanel family={family} />)}
      </ChemicalPageView>
    </>
  );
}
