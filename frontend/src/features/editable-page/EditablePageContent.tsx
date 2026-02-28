import ReactMarkdown from "react-markdown";
import { getToken } from "../../shared/api";
import { MAX_PAGE_CHARS } from "./useEditablePage";

type EditablePageContentProps = {
  content: string;
  error: string | null;
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  editText: string;
  setEditText: (v: string) => void;
  saving: boolean;
  handleSave: (e: React.FormEvent) => void;
  charCount: number;
  overLimit: boolean;
};

export function EditablePageContent({
  content,
  error,
  editMode,
  setEditMode,
  editText,
  setEditText,
  saving,
  handleSave,
  charCount,
  overLimit,
}: EditablePageContentProps) {
  const showEditButton = (getToken() ?? "") !== "" && !editMode;

  return (
    <>
      {showEditButton && (
        <button
          type="button"
          onClick={() => setEditMode(true)}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            marginBottom: "16px",
            padding: "8px 16px",
            cursor: "pointer",
            borderRadius: "8px",
            border: "1px solid grey",
            backgroundColor: "#e1c8ff",
          }}
        >
          Edit
        </button>
      )}
      {editMode ? (
        <form onSubmit={handleSave}>
          <div
            style={{
              marginBottom: "8px",
              color: overLimit ? "red" : undefined,
            }}
          >
            Characters: {charCount} / {MAX_PAGE_CHARS}
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            maxLength={MAX_PAGE_CHARS + 100}
            style={{
              width: "100%",
              minHeight: "300px",
              padding: "12px",
              fontFamily: "inherit",
              fontSize: "14px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              boxSizing: "border-box",
            }}
            placeholder="Text in Markdown format…"
          />
          <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
            <button
              type="submit"
              disabled={saving || overLimit}
              style={{
                padding: "8px 20px",
                cursor: overLimit || saving ? "not-allowed" : "pointer",
                borderRadius: "8px",
                border: "1px solid #333",
                background: overLimit || saving ? "#ccc" : "#e0e0e0",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setEditText(content);
              }}
              style={{
                padding: "8px 20px",
                cursor: "pointer",
                borderRadius: "8px",
                border: "1px solid #666",
                background: "#f5f5f5",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <p style={{ color: "red" }}>{error}</p>}
          {!error && content === "" && (
            <p style={{ color: "#666" }}>
              Page content has not been added yet.
            </p>
          )}
          {!error && content !== "" && (
            <div className="about-markdown" style={{ lineHeight: 1.6 }}>
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </>
  );
}
