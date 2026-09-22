import { useCallback, useState } from "react";
import { api, getToken } from "./utils";

type MappingVersion = { version: number; row_count: number; created_at: string };

const taxonIDMappingSchema = {
  sheet: "TaxonIDs",
  headers: ["name", "rank", "ncbi_taxid", "ena_taxid", "uniprot_taxid", "ensembl_taxid"],
} as const;

function message(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { error?: string } } }).response;
  if (response?.status === 409) return "Another admin uploaded a mapping version. Refresh its status and retry with the current version.";
  return response?.data?.error || "Could not load or upload the taxon-ID mapping.";
}

type TaxonIdMappingDialogProps = {
  open: boolean;
  busy: boolean;
  file: File | null;
  current: MappingVersion | null;
  notice: string;
  statusReady: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
};

export function TaxonIdMappingDialog({ open, busy, file, current, notice, statusReady, onClose, onRefresh, onFileChange, onSubmit }: TaxonIdMappingDialogProps) {
  if (!open) return null;
  return <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="taxon-id-mapping-title">
    <form className="admin-modal__dialog" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <h3 id="taxon-id-mapping-title">Upload taxon-ID mapping</h3>
      <p>This separate mapping does not change workbook metadata or reimport scientific data.</p>
      <p className="taxon-id-mapping-schema">Use a CSV file, or the <strong>{taxonIDMappingSchema.sheet}</strong> worksheet in an XLSX file, with these exact headers: {taxonIDMappingSchema.headers.join(", ")}.</p>
      <p className="taxon-id-mapping-status">{busy && !current ? "Loading current mapping status…" : current?.version ? `Current mapping: v${current.version} · ${current.row_count.toLocaleString()} rows · uploaded ${current.created_at}` : "No taxon-ID mapping has been uploaded."}</p>
      <label>
        Mapping file
        <input type="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event => onFileChange(event.target.files?.[0] ?? null)} />
      </label>
      {notice && <p role="status" className="taxon-id-mapping-notice">{notice}</p>}
      {!statusReady && !busy && <button type="button" className="btn" onClick={onRefresh}>Retry status</button>}
      <div className="admin-modal__actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !statusReady || !file}>Upload</button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </div>;
}

/** This upload is independent from immutable workbook metadata versions. */
export default function TaxonIdMapping() {
  const [current, setCurrent] = useState<MappingVersion | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setStatusReady(false);
    try {
      const { data } = await api.get<MappingVersion>("/admin/taxon-id-mapping", { headers: { Authorization: `Bearer ${getToken()}` } });
      setCurrent(data);
      setStatusReady(true);
      return true;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        setCurrent(null);
        setStatusReady(true);
        return true;
      }
      setCurrent(null);
      setNotice(message(error));
      return false;
    } finally { setBusy(false); }
  }, []);

  const openDialog = () => {
    setOpen(true);
    setFile(null);
    setNotice("");
    void load();
  };

  const closeDialog = () => {
    setOpen(false);
    setFile(null);
    setNotice("");
  };

  const upload = async () => {
    if (busy || !statusReady) return;
    if (!file) { setNotice("Choose an XLSX or CSV mapping file first."); return; }
    setBusy(true); setNotice("");
    const body = new FormData();
    body.append("file", file);
    body.append("base_version", String(current?.version ?? 0));
    try {
      const { data } = await api.post<MappingVersion>("/admin/taxon-id-mapping", body, { headers: { Authorization: `Bearer ${getToken()}` } });
      setCurrent(data);
      closeDialog();
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        if (await load()) setNotice("Another admin uploaded a mapping version. The current version is loaded; retry your upload.");
      } else setNotice(message(error));
    }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="btn" onClick={openDialog}>Upload taxon-ID mapping</button>
    <TaxonIdMappingDialog open={open} busy={busy} file={file} current={current} notice={notice} statusReady={statusReady} onClose={closeDialog} onRefresh={() => void load()} onFileChange={setFile} onSubmit={() => void upload()} />
  </>;
}
