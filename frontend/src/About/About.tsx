import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";

const PAGE_NAME = "about";

export default function About() {
  const state = useEditablePage(PAGE_NAME);

  if (state.loading) {
    return (
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
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
  );
}
