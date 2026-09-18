import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../shared/api";
import { cachedAboutPages, invalidateCachedAboutPages } from "../shared/apiCache";
import type { AboutSubpage } from "./aboutSubpageTypes";

export function useAboutSubpages() {
  const [pages, setPages] = useState<AboutSubpage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await cachedAboutPages();
      setPages(response.data.pages ?? []);
      setError(null);
    } catch {
      setError("Failed to load About subpages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const invalidate = () => { void refresh(); };
    window.addEventListener("about-subpages-changed", invalidate);
    return () => window.removeEventListener("about-subpages-changed", invalidate);
  }, [refresh]);

  const save = useCallback(async (next: AboutSubpage[]) => {
    const token = getToken();
    if (!token) throw new Error("Session expired. Please log in again.");
    const response = await api.put<{ pages?: AboutSubpage[] }>("/admin/about/pages", { pages: next }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await invalidateCachedAboutPages();
    setPages(response.data.pages ?? next);
    window.dispatchEvent(new Event("about-subpages-changed"));
  }, []);

  return { pages, loading, error, refresh, save };
}
