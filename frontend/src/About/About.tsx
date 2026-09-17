import { CircleInfo } from "@gravity-ui/icons";
import { useState } from "react";
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
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const isAdmin = (getToken() ?? "") !== "";

  if (state.loading || pagesLoading) {
    return (
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className={`about-layout${isAdmin ? " about-layout--admin" : ""}`} data-tour="about-content">
      <main
        className="about-layout__content"
        style={{ maxWidth: state.editMode ? "1400px" : "800px" }}
      >
        {pagesError && <p style={{ color: "var(--color-danger)" }}>{pagesError}</p>}
        {pages.length > 0 && <nav className="about-subpages" aria-label="About subpages">
          <Link className={!selected ? "is-current" : ""} to="/about" aria-current={!selected ? "page" : undefined}><CircleInfo width={20} height={20} aria-hidden="true" />About</Link>
          {pages.map((page) => <Link className={page.id === selected?.id ? "is-current" : ""} key={page.id} to={`/about/${page.id}`} aria-current={page.id === selected?.id ? "page" : undefined}><AboutIcon icon={page.icon} />{page.name}</Link>)}
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
          showEditButton={false}
        />
        {subpageID && !selected && <p style={{ color: "var(--color-danger)" }}>This About subpage does not exist.</p>}
      </main>
      {isAdmin && <aside className="about-edit-sidebar" aria-label="About editing">
        <button type="button" className="btn btn-primary" aria-expanded={editPanelOpen} onClick={() => {
          setEditPanelOpen((open) => !open);
          state.setEditMode(true);
        }}>Edit</button>
        {editPanelOpen && <div className="about-edit-sidebar__panel">
          <p className="about-edit-sidebar__hint">Editing this page as Markdown.</p>
          <AboutSubpageManager pages={pages} onEdit={(id) => navigate(`/about/${id}`)} onSave={async (next) => {
            await save(next);
            if (subpageID && !next.some((page) => page.id === subpageID)) navigate("/about");
          }} />
        </div>}
      </aside>}
    </div>
  );
}
