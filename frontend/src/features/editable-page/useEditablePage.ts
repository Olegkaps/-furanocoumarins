import { useState, useEffect, useCallback } from "react";
import { api, getToken } from "../../shared/api";

export const MAX_PAGE_CHARS = 10_000;

export function useEditablePage(pageName: string | null) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchPage = useCallback(async () => {
    if (pageName == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/pages/${encodeURIComponent(pageName)}`, {
        responseType: "text",
      });
      const text = typeof res.data === "string" ? res.data : "";
      setContent(text);
      setEditText(text);
    } catch (e: unknown) {
      const status =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { status?: number } }).response?.status
          : undefined;
      const msg = status === 404 ? null : "Failed to load page";
      setError(msg ?? null);
      if (!msg) {
        setContent("");
        setEditText("");
      }
    } finally {
      setLoading(false);
    }
  }, [pageName]);

  useEffect(() => {
    if (pageName == null) {
      setLoading(false);
      return;
    }
    fetchPage();
  }, [fetchPage, pageName]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (pageName == null) return;
      const text = editText;
      if ([...text].length > MAX_PAGE_CHARS) {
        alert(
          `Text must not exceed ${MAX_PAGE_CHARS} characters. Current: ${[...text].length}`
        );
        return;
      }
      setSaving(true);
      try {
        const token = getToken();
        await api.put(`/pages/${encodeURIComponent(pageName)}`, text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Authorization: `Bearer ${token}`,
          },
        });
        setContent(text);
        setEditMode(false);
        setEditText(text);
        setTimeout(() => fetchPage(), 1000);
      } catch {
        alert("Save failed");
      } finally {
        setSaving(false);
      }
    },
    [pageName, editText, fetchPage]
  );

  const charCount = [...editText].length;
  const overLimit = charCount > MAX_PAGE_CHARS;

  return {
    content,
    loading,
    error,
    editMode,
    setEditMode,
    editText,
    setEditText,
    saving,
    fetchPage,
    handleSave,
    charCount,
    overLimit,
  };
}
