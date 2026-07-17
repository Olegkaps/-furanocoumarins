import { useParams, useSearchParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";

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
