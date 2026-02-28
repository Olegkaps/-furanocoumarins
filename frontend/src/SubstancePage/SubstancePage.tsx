import { useParams } from "react-router-dom";
import FullNavigation from "../FullNavigation/FullNavigation";
import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";

export default function SubstancePage() {
  const { smiles: smilesEncoded } = useParams<{ smiles: string }>();
  const smiles = smilesEncoded ? decodeURIComponent(smilesEncoded) : null;

  const state = useEditablePage(smiles);

  if (smiles === null || smiles === "") {
    return (
      <>
        <FullNavigation />
        <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
          <p style={{ color: "#666" }}>Invalid page.</p>
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
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        <div key={smiles} style={{ marginBottom: "24px" }}>
          <canvas id={smiles} className="smiles" />
        </div>
        <div
          style={{
            marginBottom: "8px",
            color: "#666",
            fontFamily: "monospace",
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
