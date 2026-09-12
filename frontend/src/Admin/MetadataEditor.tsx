import { useEffect, useRef, useState } from "react";
import { api, getToken, isTokenExists } from "./utils";
import { Navigate } from "react-router-dom";
import "./MetadataEditor.css";
import MetadataPreview from "./MetadataPreview";
import { columnDomain, copyCommonColumn } from "./metadataPreviewModel";
import type { MetadataColumn as Column, MetadataSheet as Sheet, MetadataDocument as Document, PreviewColumn } from "./metadataPreviewModel";
type Version = { version: number; document: Document; created_at: string; created_by: string; provenance: string; published: boolean };

const blankDocument: Document = { schema_version: 2, importable: true, sheets: [
  { name: "main", source_sheets: ["Main"], columns: [
    { name: "name", label: "Name", data_type: "text", search: true, show_in_results: true },
    { name: "species_id", label: "Species ID", data_type: "text" },
  ] },
  { name: "classification", source_sheets: ["Species"], columns: [
    { name: "species_id", label: "Species ID", data_type: "text", primary_key: true },
    { name: "species", label: "Species", data_type: "text", search: true, show_in_results: true },
  ] },
] };
const format = (value: unknown) => JSON.stringify(value, null, 2);
const headers = () => ({ Authorization: `Bearer ${getToken()}` });
const editableCopy = (document: Document): Document => ({ ...document, schema_version: 2, sheets: document.sheets.map(sheet => ({ ...sheet, columns: sheet.columns.map(column => ({ ...column, example: column.example ?? null })) })) });
function errorMessage(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { error?: string } } }).response;
  if (response?.status === 409) return "Another admin published a version. Your draft is preserved. Refresh the latest version, review the changes, then save again.";
  return response?.data?.error || "Could not save or load metadata. Your draft is preserved; please retry.";
}

// This is a renderability check, not a replacement for server-side semantic validation.
function parseDraft(raw: string): Document {
  const doc = JSON.parse(raw);
  if (!doc || ![1, 2].includes(doc.schema_version) || typeof doc.importable !== "boolean" || !Array.isArray(doc.sheets) || !doc.sheets.every((s: Sheet) =>
    s && typeof s.name === "string" && Array.isArray(s.source_sheets) && s.source_sheets.every(v => typeof v === "string") &&
    Array.isArray(s.columns) && s.columns.every(c => c && typeof c.name === "string" && ["text", "set"].includes(c.data_type) &&
      (["label", "description", "external_sheet", "default_column", "domain", "link_template"] as const).every(key => c[key] === undefined || typeof c[key] === "string") &&
      (["primary_key", "search", "show_in_results", "reference", "smiles", "hidden"] as const).every(key => c[key] === undefined || typeof c[key] === "boolean") &&
      (c.result_order == null || typeof c.result_order === "number") &&
      (c.example == null || typeof c.example === "string") &&
      (c.legacy_flags === undefined || Array.isArray(c.legacy_flags) && c.legacy_flags.every(v => typeof v === "string")) &&
      (c.set_choices === undefined || Array.isArray(c.set_choices) && c.set_choices.every(v => typeof v === "string")) &&
      (c.classification === undefined || c.classification && typeof c.classification.level === "number" && (c.classification.tag === undefined || typeof c.classification.tag === "string"))))) {
    throw new Error("Expected schema_version 1 or 2 and sheets groups with names, source_sheets, and typed columns. Examples must be text or null. Correct the JSON before opening the UI editor.");
  }
  return doc;
}

export default function MetadataEditor() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [baseVersion, setBaseVersion] = useState(0);
  const [raw, setRaw] = useState(format(blankDocument));
  const [mode, setMode] = useState<"ui" | "json">("ui");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [columnRequest, setColumnRequest] = useState<Pick<PreviewColumn, "sheet" | "name"> | null>(null);
  const editor = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [validation, setValidation] = useState<{ raw: string; valid: boolean; message: string; resolved?: Document }>({ raw: "", valid: false, message: "Loading definition…" });

  const openEditor = (column?: PreviewColumn) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (column) setMode("ui");
    setColumnRequest(column ? { sheet: column.sheet, name: column.name } : null);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    restorePreviewFocus();
  };
  const restorePreviewFocus = () => {
    const target = returnFocus.current?.isConnected ? returnFocus.current : editor.current?.parentElement?.querySelector<HTMLButtonElement>(".metadata-preview-expand");
    target?.focus();
  };
  useEffect(() => {
    if (!editorOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setEditorOpen(false);
        restorePreviewFocus();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [editorOpen]);
  useEffect(() => {
    if (!editorOpen) return;
    const target = columnRequest && [...(editor.current?.querySelectorAll<HTMLDetailsElement>(".metadata-column") ?? [])]
      .find(element => element.dataset.sheet === columnRequest.sheet && element.dataset.column === columnRequest.name);
    if (target) {
      const sheet = target.closest<HTMLDetailsElement>(".metadata-sheet");
      if (sheet) sheet.open = true;
      target.open = true;
      target.querySelector("summary")?.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "instant" });
    } else closeButton.current?.focus();
  }, [editorOpen, columnRequest]);

  useEffect(() => {
    const controller = new AbortController();
    void api.get<Version[]>("/metadata-versions", { headers: headers(), signal: controller.signal }).then(({ data }) => {
      setVersions(data);
      const latest = data.filter(v => v.published).sort((a, b) => b.version - a.version)[0];
      setBaseVersion(latest?.version ?? 0);
      if (latest) { setRaw(format(editableCopy(latest.document))); setSelected(String(latest.version)); }
      else setNotice("No published metadata yet. Complete a definition and save it before importing.");
    }).catch(error => { if (!controller.signal.aborted) setNotice(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    try { parseDraft(raw); } catch (error) {
      setValidation({ raw, valid: false, message: (error as Error).message });
      return;
    }
    setValidation({ raw, valid: false, message: "Checking JSON and group rules…" });
    const timer = window.setTimeout(() => {
      void api.post<{ valid: boolean; resolved_document: Document }>("/metadata-versions/validate", { document: JSON.parse(raw) }, { headers: headers(), signal: controller.signal })
        .then(({ data }) => { if (!controller.signal.aborted) setValidation({ raw, valid: data.valid, resolved: data.resolved_document, message: data.valid ? "Valid JSON and group configuration." : "Invalid metadata definition." }); })
        .catch(error => { if (!controller.signal.aborted) setValidation({ raw, valid: false, message: error.response?.data?.error || "Validation unavailable. Retry after the backend is reachable." }); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [raw, busy]);

  let doc: Document | undefined;
  try { doc = parseDraft(raw); } catch { /* Raw JSON remains editable even when invalid. */ }
  const validated = validation.raw === raw && validation.valid;
  const resolved = validated ? validation.resolved : undefined;
  const update = (value: Document) => { setRaw(format(value)); setDirty(true); setNotice(""); };
  const updateSheet = (index: number, sheet: Sheet) => {
    if (doc) update({ ...doc, sheets: doc.sheets.map((item, i) => i === index ? sheet : item) });
  };
  const changeMode = (next: "ui" | "json") => {
    if (next === "ui") {
      try { parseDraft(raw); } catch (error) { setNotice((error as Error).message); return; }
    }
    setMode(next); setNotice("");
  };
  const loadVersion = (id: string) => {
    if (dirty && !window.confirm("Replace your unsaved metadata draft?")) return;
    const version = versions.find(v => String(v.version) === id);
    setSelected(id); setRaw(format(editableCopy(version?.document ?? blankDocument))); setDirty(false); setNotice("");
    setMode(version?.document.importable === false ? "json" : "ui");
  };
  const refreshLatest = async () => {
    setBusy(true);
    try {
      const { data } = await api.get<Version[]>("/metadata-versions", { headers: headers() });
      setVersions(data);
      const latest = data.filter(v => v.published).sort((a, b) => b.version - a.version)[0];
      setBaseVersion(latest?.version ?? 0);
      setNotice(`Latest is ${latest ? `v${latest.version}` : "not published"}. Your draft is unchanged. Select that version to compare it before saving.`);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setNotice("");
    try {
      const document = parseDraft(raw);
      const { data } = await api.post<Version>("/metadata-versions", { base_version: baseVersion, document }, { headers: headers() });
      setVersions(previous => [data, ...previous]); setBaseVersion(data.version);
      setRaw(format(data.document)); setSelected(String(data.version)); setDirty(false);
      setNotice(`Published metadata v${data.version}. New imports will pin this version; existing datasets are unchanged.`);
    } catch (error) { setNotice(error instanceof Error && !("response" in error) ? error.message : errorMessage(error)); }
    finally { setBusy(false); }
  };

  if (!isTokenExists()) return <Navigate to="/login" />;
  return <div className={`metadata-workbench${editorOpen ? " metadata-workbench--editing" : ""}`}>
    <MetadataPreview document={resolved} onEditColumn={openEditor} onOpenEditor={() => openEditor()} editorOpen={editorOpen} />
    <section ref={editor} id="metadata-side-editor" className="metadata-editor" hidden={!editorOpen} aria-labelledby="metadata-title">
    <div className="metadata-panel-heading"><h2 id="metadata-title">Import metadata</h2><button ref={closeButton} className="btn" type="button" onClick={closeEditor}>Close editor</button></div>
    <fieldset className="metadata-body" disabled={busy}>
    <div className="metadata-toolbar">
      <span>Latest: {baseVersion ? `v${baseVersion}` : "none"}{dirty ? " · Unsaved draft" : ""}</span>
      <button className="btn" type="button" disabled={busy} onClick={() => void refreshLatest()}>Refresh latest</button>
    </div>
    <p>A sheets group shares one column specification across its workbook sheets. The <code>main</code> group is always the root. Matching primary-key columns connect other groups automatically.</p>
    <p>Editing uses JSON format 2; existing published versions remain unchanged until you save a new version.</p>
    <div className="metadata-toolbar">
      <label>Load definition <select value={selected} disabled={busy} onChange={e => loadVersion(e.target.value)}>
        <option value="">New definition</option>
        {versions.map(v => <option key={v.version} value={v.version}>v{v.version}{v.document.importable ? v.published ? "" : " · historical" : " · incomplete"} · {v.created_at}</option>)}
      </select></label>
      <div role="group" aria-label="Metadata editing mode">
        <button className="btn" type="button" aria-pressed={mode === "ui"} onClick={() => changeMode("ui")}>UI editor</button>
        <button className="btn" type="button" aria-pressed={mode === "json"} onClick={() => changeMode("json")}>JSON editor</button>
      </div>
    </div>
    {selected && <p className="metadata-provenance">{versions.find(v => String(v.version) === selected)?.provenance}</p>}
    <p role="status" className={`metadata-validation ${validated ? "is-valid" : ""}`}>{validation.raw === raw ? validation.message : "Checking JSON and group rules…"}</p>
    {resolved && <JoinSummary document={resolved} />}
    {doc?.importable === false && <p role="alert">This historical snapshot is incomplete and cannot be used for imports. Its original declarations are retained in JSON. Supply the worksheet mappings and column definitions, then set importable to true before publishing.</p>}
    {mode === "json" ? <label className="metadata-json-label">Metadata JSON
      <textarea className="metadata-json" spellCheck={false} value={raw} onChange={e => { setRaw(e.target.value); setDirty(true); }} />
    </label> : doc && <div>
      {doc.sheets.map((sheet, si) => <details className="metadata-sheet" key={si} open={doc.sheets.length === 1 ? true : undefined}>
        <summary>{sheet.name || "Unnamed sheets group"} <span>· {sheet.columns.length} columns · {sheet.source_sheets.join(", ")}</span></summary>
        <div className="metadata-fields">
          <label>Sheets group name <input value={sheet.name} disabled={sheet.name === "main"} onChange={e => updateSheet(si, { ...sheet, name: e.target.value })} /></label>
          <label>Group primary key<select value={sheet.columns.findIndex(c => c.primary_key) < 0 ? "" : String(sheet.columns.findIndex(c => c.primary_key))} onChange={e => updateSheet(si, { ...sheet, columns: sheet.columns.map((c, i) => ({ ...c, primary_key: e.target.value !== "" && i === Number(e.target.value) })) })}>
            <option value="" disabled={sheet.name !== "main"}>{sheet.name === "main" ? "Generated row key (no workbook key)" : "Select one primary key"}</option>
            {sheet.columns.map((c, i) => <option key={i} value={i} disabled={c.data_type !== "text" || !c.name}>{c.name || "Unnamed column"}</option>)}
          </select></label>
        </div>
        <SheetNames names={sheet.source_sheets} onChange={names => updateSheet(si, { ...sheet, source_sheets: names })} />
        <p>One specification applies to every worksheet above. Use <code>structures</code> for chemicals, <code>classification</code> for species, and <code>publications</code> for future publication data.</p>
        <CommonColumns sheet={sheet} sheets={doc.sheets} onChange={columns => updateSheet(si, { ...sheet, columns })} />
        {sheet.columns.map((column, ci) => <ColumnEditor key={ci} column={column} sheet={sheet} sheets={doc.sheets}
          resolvedColumn={resolved?.sheets.find(s => s.name === sheet.name)?.columns.find(c => c.name === column.name)}
          onChange={next => updateSheet(si, { ...sheet, columns: sheet.columns.map((c, i) => i === ci ? next : c) })}
          onRemove={() => { if (window.confirm(`Remove column ${column.name || ci + 1} from this draft?`)) updateSheet(si, { ...sheet, columns: sheet.columns.filter((_, i) => i !== ci) }); }} />)}
        <div className="metadata-toolbar">
          <button type="button" className="btn" onClick={() => updateSheet(si, { ...sheet, columns: [...sheet.columns, { name: "", data_type: "text", example: null }] })}>Add column</button>
          {sheet.name !== "main" && <button type="button" className="btn btn-danger" onClick={() => { if (window.confirm(`Remove sheets group ${sheet.name} from this draft?`)) update({ ...doc, sheets: doc.sheets.filter((_, i) => i !== si) }); }}>Remove group</button>}
        </div>
      </details>)}
      <button type="button" className="btn" onClick={() => update({ ...doc, sheets: [...doc.sheets, { name: "", source_sheets: [""], columns: [] }] })}>Add sheets group</button>
    </div>}
    {notice && <p role="status" className="metadata-notice">{notice}</p>}
    <div className="metadata-toolbar metadata-footer">
      <button type="button" className="btn btn-primary" disabled={busy || !validated || doc?.importable === false} onClick={() => void save()}>{busy ? "Please wait…" : "Save as new version"}</button>
      <span>Versions are permanent. Saving does not reimport or activate data.</span>
    </div>
    </fieldset>
  </section></div>;
}

function ColumnEditor({ column: c, resolvedColumn, sheet, sheets, onChange, onRemove }: { column: Column; resolvedColumn?: Column; sheet: Sheet; sheets: Sheet[]; onChange: (column: Column) => void; onRemove: () => void }) {
  const target = resolvedColumn?.external_sheet || c.external_sheet;
  const inferredDomain = columnDomain(sheet.name, { ...c, external_sheet: target, domain: undefined });
  const domain = inferredDomain || c.domain;
  const text = (key: "name" | "label" | "description" | "link_template", label: string) => <label>{label}<input value={c[key] ?? ""} onChange={e => onChange({ ...c, [key]: e.target.value })} /></label>;
  const flags: [keyof Column, string][] = [["search", "Use in search"], ["show_in_results", "Show in results table"], ["reference", "Publication references"], ...(domain === "chemical" ? [["smiles", "SMILES structure"] as [keyof Column, string]] : []), ["hidden", "Hide from all result views (overrides display)"]];
  const title = `${c.name || "New column"}${c.primary_key ? " · Primary key" : ""}`;
  return <details className="metadata-column" data-sheet={sheet.name} data-column={c.name}>
    <summary>{title}</summary>
    <fieldset className="metadata-column-body" aria-label={title}>
    <p className="metadata-column-shared">Common to: {sheets.filter(s => s.columns.some(other => other.name === c.name)).map(s => s.name || "Unnamed group").join(", ")}. {target ? `Joins ${sheet.name}.${c.name} to ${target}.${c.name}.` : "No join on this column."}</p>
    <div className="metadata-fields">
      {text("name", "Column name")}{text("label", "Display label")}{text("description", "Description")}
      <label>Data type<select value={c.data_type} onChange={e => onChange({ ...c, data_type: e.target.value as Column["data_type"], set_choices: e.target.value === "set" ? c.set_choices : undefined })}><option value="text">Text</option><option value="set" disabled={c.primary_key || Boolean(target)}>Set of text values</option></select></label>
      <label>Entity<select value={c.domain ?? ""} onChange={e => { const next = e.target.value || undefined; const effective = inferredDomain || next; onChange({ ...c, domain: next as Column["domain"], classification: effective === "species" ? c.classification : undefined, smiles: effective === "chemical" ? c.smiles : undefined }); }}><option value="">{inferredDomain ? `Automatic (${inferredDomain})` : "General"}</option>{(["chemical", "species", "publication"] as const).map(entity => <option key={entity} value={entity} disabled={Boolean(inferredDomain) && inferredDomain !== entity}>{entity === "publication" ? "Publication (future use)" : entity === "chemical" ? "Chemical" : "Species"}</option>)}</select></label>
      <label>Example (optional)<input value={c.example ?? ""} placeholder={`value from column ${c.name || "X"}`} onChange={e => onChange({ ...c, example: e.target.value === "" ? null : e.target.value })} /><small>Empty is stored as null. It never prevents a preview.</small></label>
      {c.show_in_results && <label>Result position (optional, starts at 0)<input type="number" min="0" step="1" value={c.result_order ?? ""} onChange={e => onChange({ ...c, result_order: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>}
    </div>
    <div className="metadata-flags">{flags.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(c[key])} onChange={e => onChange({ ...c, [key]: e.target.checked, ...(key === "show_in_results" && !e.target.checked ? { result_order: undefined } : {}) })} />{label}</label>)}</div>
    {c.data_type === "set" && <label>Fixed choices (one per line; leave empty to derive from imported data)<textarea value={(c.set_choices ?? []).join("\n")} onChange={e => onChange({ ...c, set_choices: e.target.value ? e.target.value.split("\n") : undefined })} /></label>}
    {c.smiles && domain !== "chemical" && <p role="alert">SMILES is only allowed for chemicals. <button type="button" className="btn" onClick={() => onChange({ ...c, smiles: undefined })}>Remove SMILES setting</button></p>}
    {c.classification && domain !== "species" && <p role="alert">Classification is only allowed for species. <button type="button" className="btn" onClick={() => onChange({ ...c, classification: undefined })}>Remove classification setting</button></p>}
    <details><summary>Defaults, links{domain === "species" ? " and classification" : ""}</summary>
      {c.legacy_flags && c.legacy_flags.length > 0 && <p>Preserved legacy flags: {c.legacy_flags.join(", ")}. Edit these in JSON if needed.</p>}
      <div className="metadata-fields">
        <label>Default from column<select value={c.default_column ?? ""} onChange={e => onChange({ ...c, default_column: e.target.value || undefined })}><option value="">No default</option>{sheet.columns.filter(other => other.name !== c.name).map((other, i) => <option key={i} value={other.name}>{other.name}</option>)}</select></label>
        {text("link_template", "Link template (HTTPS path with %s)")}
        {domain === "species" && <label>Classification level (optional)<input type="number" min="0" step="1" value={c.classification?.level ?? ""} onChange={e => onChange({ ...c, classification: e.target.value === "" ? undefined : { ...c.classification, level: Number(e.target.value) } })} /></label>}
        {domain === "species" && c.classification && <label>Classification source tag<input value={c.classification.tag ?? ""} onChange={e => onChange({ ...c, classification: { level: c.classification!.level, tag: e.target.value } })} /></label>}
      </div>
    </details>
    <button className="btn btn-danger" type="button" onClick={onRemove}>Remove column</button>
    </fieldset>
  </details>;
}

function SheetNames({ names, onChange }: { names: string[]; onChange: (names: string[]) => void }) {
  const move = (index: number, delta: number) => { const next = [...names]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next); };
  return <fieldset className="metadata-sheet-names"><legend>Workbook sheets</legend>
    <ol>{names.map((name, index) => <li key={index}>
      <input aria-label={`Workbook sheet ${index + 1}`} value={name} onChange={e => onChange(names.map((value, i) => i === index ? e.target.value : value))} />
      <button className="btn" type="button" aria-label={`Move sheet ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
      <button className="btn" type="button" aria-label={`Move sheet ${index + 1} down`} disabled={index === names.length - 1} onClick={() => move(index, 1)}>↓</button>
      <button className="btn" type="button" aria-label={`Remove sheet ${index + 1}`} onClick={() => onChange(names.filter((_, i) => i !== index))}>Remove</button>
    </li>)}</ol>
    <button className="btn" type="button" onClick={() => onChange([...names, ""])}>Add workbook sheet</button>
  </fieldset>;
}

function CommonColumns({ sheet, sheets, onChange }: { sheet: Sheet; sheets: Sheet[]; onChange: (columns: Column[]) => void }) {
  const candidates = new Map<string, { column: Column; groups: string[]; primary: boolean }>();
  for (const other of sheets) {
    if (other === sheet) continue;
    for (const column of other.columns) {
      if (!column.name) continue;
      const existing = candidates.get(column.name);
      if (existing) { existing.groups.push(other.name); existing.primary ||= Boolean(column.primary_key); }
      else candidates.set(column.name, { column: copyCommonColumn(other.name, column), groups: [other.name], primary: Boolean(column.primary_key) });
    }
  }
  return <details className="metadata-common"><summary>Common columns with other groups</summary>
    <p>Select columns present in this group’s worksheets. A shared column matching another group’s primary key creates its join automatically. Non-key shared columns do not create joins.</p>
    <p>Shared columns must have matching settings. If a column uses a default, also include its default column.</p>
    {candidates.size === 0 ? <p>Add another group to share columns.</p> : <ul>{[...candidates].map(([name, { column, groups, primary }]) => {
      const current = sheet.columns.find(c => c.name === name);
      return <li key={name}><label><input type="checkbox" checked={Boolean(current)} disabled={current?.primary_key} onChange={e => {
        if (e.target.checked) onChange([...sheet.columns, column]);
        else if (window.confirm(`Remove ${name} from group ${sheet.name}? Other groups keep it.`)) onChange(sheet.columns.filter(c => c.name !== name));
      }} /><span><strong>{name}</strong> · {groups.join(", ")}{primary ? " · target primary key" : ""}</span></label></li>;
    })}</ul>}
  </details>;
}

function JoinSummary({ document }: { document: Document }) {
  const visited = new Set<string>();
  const joins: { source: string; target: string; column: string }[] = [];
  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const column of document.sheets.find(s => s.name === name)?.columns ?? []) {
      if (!column.external_sheet) continue;
      joins.push({ source: name, target: column.external_sheet, column: column.name }); visit(column.external_sheet);
    }
  };
  visit("main");
  return <section className="metadata-joins" aria-label="Group joins"><h3>Group joins</h3><p><strong>main</strong> is the root.</p>
    {joins.length > 0 ? <ul>{joins.map((join, i) => <li key={i}><strong>{join.source}</strong> → <strong>{join.target}</strong> on <code>{join.column}</code></li>)}</ul> : <p>No joined groups yet. Select a shared primary-key column to connect a group.</p>}
    {document.sheets.filter(s => !visited.has(s.name)).map(s => <p key={s.name}>{s.name}: preserved separately, not joined to main.</p>)}
  </section>;
}
