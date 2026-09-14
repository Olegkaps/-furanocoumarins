import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken } from "../shared/api";
import type { Finding } from "./publicationReaderModel";
import { copyExport, downloadExport, exportPayload, lookupCandidates, lookupRequest, mainColumns, MAX_ROWS, PAGE_SIZE, predictedValue, schemaColumns, scheduleLookup } from "./publicationExportModel";
import type { Candidate, CellValue, ExportColumn } from "./publicationExportModel";
import "./PublicationMainExport.css";
import { ChevronLeft, ChevronRight, Xmark } from "@gravity-ui/icons";

async function read(path: string, signal: AbortSignal, params?: Record<string, string>) {
  const response = await api.get(path, { signal, params, timeout: 15000, headers: path === "/metadata-versions/latest" ? { Authorization: `Bearer ${getToken()}` } : {}, responseType: "text", transformResponse: [(text: string) => {
    if (text.length > 2 * 1024 * 1024) throw new Error("Response too large; narrow the filter.");
    return JSON.parse(text);
  }] });
  return response.data;
}
type Update = (index: number, column: string, value: CellValue, automatic?: boolean) => void;

function Lookup({ index, column, seed, value, schema, update, disabled }: { index: number; column: ExportColumn; seed: string; value?: CellValue; schema: Set<string>; update: Update; disabled: boolean }) {
  const [term, setTerm] = useState(seed.slice(0, 200));
  const [edited, setEdited] = useState(false);
  const [speciesOnly, setSpeciesOnly] = useState(false);
  const [result, setResult] = useState<{ term: string; candidates: Candidate[]; message: string }>();
  const generation = useRef(0);
  const request = lookupRequest(column.lookup!, term, column.lookupFields, speciesOnly);
  const projection = column.lookupFields ?? request?.projection ?? [];
  const supported = projection.every(name => schema.has(name));
  useEffect(() => {
    const run = ++generation.current;
    if (!edited || disabled) return;
    const request = lookupRequest(column.lookup!, term, column.lookupFields, speciesOnly);
    update(index, column.name, { id: "", manual: false }, true);
    if (!request || !supported) return;
    return scheduleLookup(signal => read("/search", signal, { q: request.query, columns: request.projection.join(","), limit: "100" }), data => {
        if (generation.current !== run) return;
        const found = lookupCandidates(data, request);
        setResult({ term, candidates: found.candidates, message: found.omitted ? "More results omitted; narrow the filter." : found.prediction ? "Unverified exact-name prediction" : "Unresolved: select an identity." });
        update(index, column.name, predictedValue(undefined, found.prediction), true);
      }, error => {
        if (generation.current === run) setResult({ term, candidates: [], message: error instanceof Error ? error.message : "Lookup failed." });
      });
  }, [column.lookup, column.lookupFields, column.name, disabled, edited, index, schema, speciesOnly, supported, term, update]);
  const current = result?.term === term ? result : undefined;
  return <div className="publication-main-export__lookup">
    {column.lookup === "species" && <label>Filter<select disabled={disabled} value={speciesOnly ? "species" : "taxon"} onChange={event => { generation.current++; setSpeciesOnly(event.target.value === "species"); setEdited(true); setTerm(""); }}><option value="taxon">Genus and optional species</option><option value="species">Species only</option></select></label>}
    <label>{column.lookup === "chemical" ? "Chemical name" : speciesOnly ? "Species epithet" : "Genus / species"}<input disabled={disabled} value={term} maxLength={200} placeholder="Start typing" onFocus={() => setEdited(true)} onChange={event => { generation.current++; setEdited(true); setTerm(event.target.value); }} /></label>
    <small role="status">{!supported ? "Active search schema does not support this lookup." : !term.trim() ? "Start typing" : !edited ? "Not filtered" : !request ? "Invalid taxon filter." : current?.message ?? "Looking up..."}</small>
    {!!current?.candidates.length && <label>Matching identities<select value="" onChange={event => {
      const candidate = current.candidates.find(candidate => candidate.id === event.target.value);
      if (candidate) update(index, column.name, { id: candidate.id, name: candidate.name, manual: true });
    }}><option value="">Select an identity</option>{current.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} | {candidate.id}</option>)}</select></label>}
    <div>{value?.id ? `${value.name ?? "Selected identity"} | ${value.id}` : "Unresolved"} {value?.manual ? "(manual selection)" : ""}</div>
    <button type="button" title="Clear ID" aria-label="Clear ID" onClick={() => update(index, column.name, { id: "", manual: true })}><Xmark /></button>
    <details><summary>Query and projection</summary><code>{request?.query ?? "No query"}</code><div>Projection: {projection.join(", ")}</div></details>
  </div>;
}

export function PublicationMainExport({ findings, onSelectFinding, selectedFinding }: { findings: Finding[]; onSelectFinding: (index: number) => void; selectedFinding: number }) {
  const [metadata, setMetadata] = useState<ReturnType<typeof mainColumns>>();
  const [schema, setSchema] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [schemaError, setSchemaError] = useState("");
  const [retry, setRetry] = useState(0);
  const [owner, setOwner] = useState(findings);
  const [values, setValues] = useState<Record<number, Record<string, CellValue>>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [reference, setReference] = useState("");
  const [headers, setHeaders] = useState(true);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const copyBusy = useRef(false);
  const resolver = useRef<AbortController | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("IDs not resolved");
  const preview = useRef<HTMLTextAreaElement>(null);
  if (owner !== findings) { resolver.current?.abort(); setOwner(findings); setValues({}); setExcluded(new Set()); setReference(""); setPage(0); setNotice(""); setResolution("IDs not resolved"); }
  useEffect(() => {
    if (Number.isInteger(selectedFinding) && selectedFinding >= 0 && selectedFinding < findings.length) setPage(Math.floor(selectedFinding / PAGE_SIZE));
  }, [selectedFinding, findings]);
  useEffect(() => () => resolver.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void read("/metadata-versions/latest", controller.signal).then(data => {
      if (!controller.signal.aborted) { setMetadata(mainColumns(data)); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load published main-sheet metadata. Retry."); });
    void read("/metadata", controller.signal).then(data => {
      if (!controller.signal.aborted) { setSchema(schemaColumns(data)); setSchemaError(""); }
    }).catch(() => { if (!controller.signal.aborted) setSchemaError("Could not load active search schema. Retry."); });
    return () => controller.abort();
  }, [retry]);
  const update = useCallback<Update>((index, column, value, automatic = false) => {
    setValues(previous => {
      if (automatic && previous[index]?.[column]?.manual) return previous;
      return { ...previous, [index]: { ...previous[index], [column]: value } };
    });
  }, []);
  const columns = metadata?.columns ?? [];
  const bounded = findings.length <= MAX_ROWS;
  const selected = bounded ? findings.map((_, index) => index).filter(index => !excluded.has(index)) : [];
  const payload = exportPayload(columns, selected.map(index => Object.fromEntries(columns.map(column => [column.name, values[index]?.[column.name]?.id ?? (column.reference ? reference : "")]))), headers);
  const selectPreview = () => { preview.current?.focus(); preview.current?.select(); };
  const disabled = !metadata || !selected.length || !bounded || resolving;
  const pages = Math.max(1, Math.ceil(findings.length / PAGE_SIZE));
  return <section className="publication-main-export" aria-label="Main sheet draft">
    <h2>Main sheet draft</h2><p>Unverified candidates. Unresolved cells are blank.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {schemaError && <p role="alert">{schemaError} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!metadata && !error && <p role="status">Loading published metadata...</p>}
    {metadata && <p>Published metadata v{metadata.version} | {metadata.sheets.join(", ")}</p>}
    {!bounded && <p role="alert">Too many findings. Export supports up to {MAX_ROWS} rows.</p>}
    {columns.some(column => column.reference) && <label>Reference ID<input value={reference} maxLength={500} onChange={event => setReference(event.target.value)} /></label>}
    <div className="publication-main-export__toolbar"><label><input type="checkbox" checked={headers} onChange={event => setHeaders(event.target.checked)} />Column headers</label>
      <button type="button" disabled={disabled || !schema.size} onClick={() => {
        const controller = new AbortController(); resolver.current?.abort(); resolver.current = controller; setResolving(true);
        const cache = new Map<string, ReturnType<typeof lookupCandidates>>();
        const work = selected.flatMap(index => columns.filter(column => column.lookup).map(column => ({ index, column })));
        void (async () => {
          let done = 0, failed = 0;
          for (const { index, column } of work) {
            if (controller.signal.aborted) return;
            const term = column.lookup === "chemical" ? findings[index].chemical : findings[index].species;
            const request = lookupRequest(column.lookup!, term, column.lookupFields);
            let prediction;
            try {
              if (request && request.projection.every(field => schema.has(field))) {
                const key = JSON.stringify(request);
                if (!cache.has(key)) cache.set(key, lookupCandidates(await read("/search", controller.signal, { q: request.query, columns: request.projection.join(","), limit: "100" }), request));
                prediction = cache.get(key)?.prediction;
              }
            } catch { failed++; }
            if (controller.signal.aborted) return;
            update(index, column.name, predictedValue(undefined, prediction), true);
            setResolution(`${++done} / ${work.length} fields checked; ${failed} lookup failures`);
          }
          if (!work.length) setResolution("No identity fields in this metadata");
        })().finally(() => { if (resolver.current === controller) setResolving(false); });
      }}>Resolve IDs</button><span role="status">{resolution}</span>
      {resolving && <button type="button" onClick={() => { resolver.current?.abort(); setResolving(false); setResolution("Resolution cancelled; completed values retained."); }}>Cancel resolution</button>}
      <button type="button" onClick={() => setExcluded(new Set())}>Select all</button><button type="button" onClick={() => setExcluded(new Set(findings.map((_, index) => index)))}>Clear selection</button><span>{selected.length} selected</span>
      <button type="button" disabled={disabled || copying} onClick={() => {
        if (copyBusy.current) return;
        copyBusy.current = true; setCopying(true); setNotice("Copying...");
        const count = selected.length;
        void copyExport(payload, selectPreview).then(format => setNotice(`${count} rows copied${format === "text" ? " as TSV only" : " as HTML and TSV"} (selection at click).`)).catch(() => { selectPreview(); setNotice("Clipboard blocked. TSV selected for manual copying, or use Download TSV."); }).finally(() => { copyBusy.current = false; setCopying(false); });
      }}>Copy</button>
      <button type="button" disabled={disabled} onClick={() => { try { downloadExport(payload.text); setNotice("TSV download requested."); } catch { selectPreview(); setNotice("Download unavailable. TSV selected for manual copying."); } }}>Download TSV</button>
    </div>
    {metadata && bounded && <><div className="publication-main-export__scroll"><table><thead><tr><th>Include</th><th>Finding</th>{columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>
      {findings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((finding, offset) => { const index = page * PAGE_SIZE + offset; return <tr key={index} aria-current={selectedFinding === index}>
        <td><input type="checkbox" aria-label={`Include finding ${index + 1}`} checked={!excluded.has(index)} onChange={event => setExcluded(previous => { const next = new Set(previous); if (event.target.checked) next.delete(index); else next.add(index); return next; })} /></td>
        <td><button type="button" onClick={() => onSelectFinding(index)}>{finding.species} - {finding.chemical}</button></td>
        {columns.map(column => <td key={column.name}>{column.lookup ? <Lookup key={`${index}:${finding.chemical}:${finding.species}`} index={index} column={column} seed={column.lookup === "chemical" ? finding.chemical : finding.species} value={values[index]?.[column.name]} schema={schema} update={update} disabled={resolving} /> : <input aria-label={`${column.name}, finding ${index + 1}`} value={values[index]?.[column.name]?.id ?? (column.reference ? reference : "")} maxLength={1000} onChange={event => update(index, column.name, { id: event.target.value, manual: true })} />}</td>)}
      </tr>; })}
    </tbody></table></div><nav aria-label="Export pages"><button type="button" title="Previous export page" aria-label="Previous export page" disabled={!page} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><span>{page + 1} / {pages}</span><button type="button" title="Next export page" aria-label="Next export page" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></nav></>}
    <label>Selected rows (TSV)<textarea ref={preview} readOnly value={payload.text} spellCheck={false} /></label><p role="status">{notice}</p>
  </section>;
}
