import { useEffect, useState } from "react";
import { api, getToken } from "../shared/api";
import OmicsPreview from "./OmicsPreview";
import type { OmicsCount, OmicsTaxon } from "./omics";

type Snapshot = {
  source: OmicsCount["source"];
  type: OmicsCount["type"];
  external_taxid: string;
  count: number;
  checked_at: string;
};
type Availability = { dataset_version: string; snapshots: Snapshot[] };

/** Saved observations are informational; only fresh provider counts gate previews. */
export default function OmicsAvailability({ taxon }: { taxon: OmicsTaxon }) {
  const [saved, setSaved] = useState<Availability | null>(null);
  const [counts, setCounts] = useState<OmicsCount[]>([]);
  const [notice, setNotice] = useState("");
  const endpoint = `/taxa/${taxon.rank}/availability`;
  const id = taxon.id;
  const name = taxon.name;

  useEffect(() => {
    const controller = new AbortController();
    void api.get<Availability>(endpoint, {
      params: id ? { id } : { name }, signal: controller.signal,
    }).then(({ data }) => setSaved(data)).catch(() => {
      if (!controller.signal.aborted) setNotice("Saved counts are unavailable. Live database searches still work.");
    });
    return () => controller.abort();
  }, [endpoint, id, name]);

  const dataset = saved?.dataset_version;
  useEffect(() => {
    const token = getToken();
    if (!dataset || !token || counts.some(row => row.status === "loading")) return;
    const snapshots = counts.filter(row => row.status === "ready" && row.count !== null && row.providerTaxonId)
      .map(row => ({ source: row.source, type: row.type, external_taxid: row.providerTaxonId!, count: row.count!, checked_at: row.countedAt }));
    if (!snapshots.length) return;
    const controller = new AbortController();
    setNotice("Saving count snapshot…");
    void api.put<Availability>(endpoint, { dataset_version: dataset, snapshots }, {
      params: id ? { id } : { name }, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    }).then(({ data }) => {
      setSaved(data);
      setNotice("Count snapshot saved.");
    }).catch(error => {
      if (controller.signal.aborted) return;
      setNotice(error?.response?.status === 409 ? "The active dataset changed. Reload this page before saving counts."
        : error?.response?.status === 403 ? "Only admins can save count snapshots."
          : "Could not save count snapshots. Live results are still available.");
    });
    return () => controller.abort();
  }, [counts, dataset, endpoint, id, name]);

  return <div style={{ clear: "both" }}>
    <OmicsPreview taxon={taxon} onCounts={setCounts} />
    {notice && <p role="status" className="muted">{notice}</p>}
    {!!saved?.snapshots?.length && <details>
      <summary>Previously saved availability</summary>
      <p>Browser-observed counts, not a live total. NCBI and ENA may contain overlapping records.</p>
      <ul>{saved.snapshots.map(row => <li key={`${row.source}:${row.type}:${row.external_taxid}`}>
        {row.source.toUpperCase()} · {row.type} · {row.count.toLocaleString()} records · lookup {row.external_taxid} · checked {new Date(row.checked_at).toLocaleString()}
      </li>)}</ul>
    </details>}
  </div>;
}
