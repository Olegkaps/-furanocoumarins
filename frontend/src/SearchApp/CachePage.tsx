import { useCallback, useEffect, useState } from "react";
import { Database, TrashBin, ArrowRotateRight } from "@gravity-ui/icons";
import FullNavigation from "../FullNavigation/FullNavigation";
import {
  clearApiCache,
  deleteApiCacheEntry,
  listApiCache,
  type ApiCacheInfo,
  type ApiCacheKind,
} from "../shared/apiCache";
import { PageTour } from "../shared/tour/PageTour";

function formatTs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function kindLabel(kind: ApiCacheKind): string {
  switch (kind) {
    case "search":
      return "search";
    case "metadata":
      return "metadata";
    case "article":
      return "article";
    default:
      return kind;
  }
}

export default function CachePage() {
  const [entries, setEntries] = useState<ApiCacheInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listApiCache());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read cache");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearOne = async (id: string) => {
    await deleteApiCacheEntry(id);
    await refresh();
  };

  const clearAll = async () => {
    if (entries.length === 0) return;
    if (!window.confirm("Clear the entire API cache?")) return;
    await clearApiCache();
    await refresh();
  };

  return (
    <>
      <FullNavigation pageName="cache" />
      <PageTour tourId="cache" />
      <div className="cache-page">
        <header className="cache-page__header">
          <h1 className="cache-page__title">
            <Database width={28} height={28} aria-hidden />
            API cache
          </h1>
          <div className="cache-page__toolbar" data-tour="cache-toolbar">
            <button
              type="button"
              className="btn"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh"
            >
              <ArrowRotateRight width={16} height={16} />
              Refresh
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void clearAll()}
              disabled={loading || entries.length === 0}
              title="Clear all"
            >
              <TrashBin width={16} height={16} />
              Clear all
            </button>
          </div>
        </header>

        {error && <p className="empty-state">{error}</p>}
        {loading && entries.length === 0 ? (
          <p className="empty-state">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="empty-state" data-tour="cache-table">
            Cache is empty.
          </p>
        ) : (
          <div className="cache-page__table-wrap" data-tour="cache-table">
            <table className="cache-page__table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Key</th>
                  <th>Cached at</th>
                  <th>Expires at</th>
                  <th>Store</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className={e.expired ? "cache-page__row--expired" : undefined}
                  >
                    <td>
                      <span className="cache-page__kind">{kindLabel(e.kind)}</span>
                    </td>
                    <td>
                      <code className="cache-page__key" title={e.key}>
                        {e.key}
                      </code>
                    </td>
                    <td>
                      <time dateTime={new Date(e.writtenAt).toISOString()}>
                        {formatTs(e.writtenAt)}
                      </time>
                    </td>
                    <td>
                      <time dateTime={new Date(e.expiresAt).toISOString()}>
                        {formatTs(e.expiresAt)}
                      </time>
                      {e.expired && (
                        <span className="cache-page__expired-tag">expired</span>
                      )}
                    </td>
                    <td className="cache-page__sources">
                      {e.sources.join(", ")}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn cache-page__delete"
                        title="Remove this entry"
                        aria-label={`Remove ${e.key}`}
                        onClick={() => void clearOne(e.id)}
                      >
                        <TrashBin width={14} height={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
