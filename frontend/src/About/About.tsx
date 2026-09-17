import { useEditablePage } from "../features/editable-page/useEditablePage";
import { EditablePageContent } from "../features/editable-page/EditablePageContent";
import { Link, useNavigate } from "react-router-dom";
import { getToken } from "../shared/api";
import { AboutIcon } from "./aboutSubpages";
import { aboutPageStorageName } from "./aboutSubpageTypes";
import { useAboutSubpages } from "./useAboutSubpages";
import { AboutSubpageManager } from "./AboutSubpageManager";
import { defaultAboutMarkdown } from "./defaultAboutMarkdown";

const PAGE_NAME = "about";

export default function About({ subpageID }: { subpageID?: string }) {
  const { pages, loading: pagesLoading, error: pagesError, save } = useAboutSubpages();
  const selected = pages.find((page) => page.id === subpageID);
  const state = useEditablePage(selected ? aboutPageStorageName(selected.id) : PAGE_NAME, selected ? "" : defaultAboutMarkdown);
  const navigate = useNavigate();

  if (state.loading || pagesLoading) {
    return (
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        Loading…
      </div>
    );
  }

  return (
    <div
      data-tour="about-content"
      style={{
        padding: "24px",
        maxWidth: state.editMode ? "1400px" : "800px",
        margin: "0 auto",
      }}
    >
      {pagesError && <p style={{ color: "var(--color-danger)" }}>{pagesError}</p>}
      {pages.length > 0 && <nav className="about-subpages" aria-label="About subpages">
        {pages.map((page) => <Link className={page.id === selected?.id ? "is-current" : ""} key={page.id} to={`/about/${page.id}`}><AboutIcon icon={page.icon} />{page.name}</Link>)}
      </nav>}
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
      {subpageID && !selected && <p style={{ color: "var(--color-danger)" }}>This About subpage does not exist.</p>}
      {(getToken() ?? "") !== "" && <AboutSubpageManager pages={pages} onSave={async (next) => {
        await save(next);
        if (subpageID && !next.some((page) => page.id === subpageID)) navigate("/about");
      }} />}
    </div>
  );
}
