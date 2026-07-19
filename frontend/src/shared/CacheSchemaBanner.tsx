import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleInfo, TrashBin, Xmark } from "@gravity-ui/icons";
import { cachedGet, clearApiCache } from "./apiCache";
import {
  clearSchemaSuspicion,
  guardMetadataCatalog,
  subscribeSchemaSuspicion,
  type SchemaSuspicion,
} from "./schemaGuard";

export function CacheSchemaBanner() {
  const [issue, setIssue] = useState<SchemaSuspicion | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeSchemaSuspicion(setIssue), []);

  // Warm the metadata catalog so search responses can be checked against it
  // even if the user never opened the search form in this session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await cachedGet("/metadata");
        if (cancelled || response?.status !== 200) return;
        guardMetadataCatalog(response.data?.["metadata"], response.data);
      } catch {
        /* ignore — form/search paths still guard on their own */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!issue) return null;

  const clearNow = async () => {
    setBusy(true);
    try {
      await clearApiCache();
      clearSchemaSuspicion();
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="cache-schema-banner" role="status">
      <CircleInfo width={20} height={20} className="cache-schema-banner__icon" />
      <div className="cache-schema-banner__text">
        <p className="cache-schema-banner__title">{issue.message}</p>
        <p className="cache-schema-banner__detail">
          {issue.detail ??
            "If the site was updated recently, clearing the API cache usually helps."}{" "}
          You can also review entries on the{" "}
          <Link to="/cache">API cache</Link> page.
        </p>
      </div>
      <div className="cache-schema-banner__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void clearNow()}
          title="Clear API cache and reload"
        >
          <TrashBin width={14} height={14} />
          Clear cache
        </button>
        <button
          type="button"
          className="cache-schema-banner__dismiss"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={() => clearSchemaSuspicion()}
        >
          <Xmark width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
