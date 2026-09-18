import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { api } from "../shared/api";
import { EntityDetailTable } from "../SearchApp/EntityDetailTable";
import { entityCondition, entityPageColumns, rowFromEntitySearch } from "../SearchApp/entityPageDetails";
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

export default function SubstancePage() {
  const { smiles: smilesEncoded } = useParams<{ smiles: string }>();
  const [searchParams] = useSearchParams();
  const smiles = resolveSmiles(smilesEncoded, searchParams);

  const state = useEditablePage(smiles);
  const [details, setDetails] = useState<{ meta: DataMeta[]; row: Map<string, string> } | null>(null);

  useEffect(() => {
    setDetails(null);
    if (!smiles) return;
    let current = true;
    void api.get<{ metadata: Array<{ column: string; name: string; description: string; type: string }> }>("/metadata").then(({ data }) => {
      const meta = entityPageColumns(data.metadata, "chemical");
      const smilesColumn = data.metadata.find(column => /(?:^|\\s)SMILES(?:\\s|$)/.test(column.type))?.column;
      if (!smilesColumn || meta.length === 0) return null;
      const smilesMeta = data.metadata.find(column => column.column === smilesColumn)!;
      return api.get<{ metadata: Array<{ column: string; name: string; description: string; type: string }>; data: Array<Record<string, unknown>> }>("/search", { params: { q: entityCondition(smilesMeta, smiles), columns: meta.map(column => column.name).join(","), limit: 2 } }).then(({ data: response }) => ({ meta, row: rowFromEntitySearch(response) }));
    }).then(value => { if (current) setDetails(value?.row ? { meta: value.meta, row: value.row } : null); }).catch(() => { if (current) setDetails(null); });
    return () => { current = false; };
  }, [smiles]);

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
      <div
        style={{
          padding: "24px",
          maxWidth: state.editMode ? "1400px" : "800px",
          margin: "0 auto",
        }}
      >
        <div key={smiles} style={{ marginBottom: "24px" }}>
          <canvas
            id={smilesCanvasId(smiles)}
            className="smiles"
            data-smiles={smiles}
          />
        </div>
        <div
          style={{
            marginBottom: "8px",
            color: "var(--color-muted)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "14px",
          }}
        >
          SMILES: {smiles}
        </div>
        {details && <aside aria-label="Chemical details" style={{ float: "right", width: "min(340px, 40%)", margin: "0 0 16px 24px" }}><EntityDetailTable meta={details.meta} row={details.row} /></aside>}
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
      </div>
    </>
  );
}
