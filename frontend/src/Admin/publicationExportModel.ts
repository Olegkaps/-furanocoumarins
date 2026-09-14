import type { MetadataColumn, MetadataDocument } from "./metadataPreviewModel";

export type ExportColumn = MetadataColumn & { lookup?: "chemical" | "species"; lookupFields?: string[] };
export type Candidate = { id: string; name: string; exact: boolean };
export const PAGE_SIZE = 10;
export const MAX_ROWS = 5000;
export const MAX_RESULTS = 20;
const normalized = (text: string) => text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
const literal = (text: string) => "'" + text.replace(/'/g, "''") + "'";

export function mainColumns(value: unknown): { version: number; columns: ExportColumn[]; sheets: string[] } {
  const version = value as { published?: boolean; version?: number; document?: MetadataDocument };
  const doc = version?.document;
  const main = doc?.sheets?.filter(sheet => sheet.name === "main");
  if (!version?.published || !Number.isSafeInteger(version.version) || !doc?.importable || ![1, 2].includes(doc.schema_version) || main?.length !== 1 || !Array.isArray(main[0].columns) || !main[0].columns.length || main[0].columns.length > 100) throw new Error("Published main-sheet metadata is unavailable.");
  if (!Array.isArray(main[0].source_sheets) || main[0].source_sheets.some(name => typeof name !== "string")) throw new Error("Invalid main-sheet worksheet mapping.");
  const columns = main[0].columns.map(column => {
    if (!column || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column.name) || !["text", "set"].includes(column.data_type)) throw new Error("Invalid main-sheet column.");
    const targets = doc.sheets.filter(sheet => sheet.name !== "main" && (column.external_sheet ? sheet.name === column.external_sheet : doc.schema_version === 2 && sheet.columns.some(key => key.primary_key && key.name === column.name)));
    const target = targets.length === 1 ? targets[0] : undefined;
    const domain = column.domain ?? (target?.name.startsWith("structures") ? "chemical" : target?.name.startsWith("classification") ? "species" : undefined);
    const isKey = target?.columns.some(key => key.primary_key && key.name === column.name);
    const lookup = column.reference ? undefined : isKey && domain === "chemical" || column.name === "pubchemcid" ? "chemical" : isKey && domain === "species" || column.name === "lsid_original" ? "species" : undefined;
    const named = target?.columns.filter(field => field.list_name) ?? [];
    const chemicalName = named.length === 1 ? named[0].name : "names";
    const taxonField = (name: string) => target?.columns.find(field => field.name === `${name}_original`)?.name ?? target?.columns.find(field => field.name === name)?.name ?? `${name}_original`;
    const lookupFields = lookup === "chemical" ? [column.name, chemicalName] : lookup === "species" ? [column.name, taxonField("genus"), taxonField("species")] : undefined;
    return { ...column, lookup, lookupFields } as ExportColumn;
  });
  if (new Set(columns.map(column => column.name)).size !== columns.length) throw new Error("Duplicate main-sheet columns.");
  return { version: version.version!, columns, sheets: main[0].source_sheets };
}

export function lookupRequest(kind: "chemical" | "species", term: string, fields = kind === "chemical" ? ["pubchemcid", "names"] : ["lsid_original", "genus_original", "species_original"], speciesOnly = false) {
  term = term.trim();
  if (!term || term.length > 200 || fields.length !== (kind === "chemical" ? 2 : 3) || fields.some(field => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field))) return null;
  if (kind === "chemical") return { query: `${fields[1]} LIKE ${literal("%" + term + "%")}`, projection: fields, term, kind };
  const parts = term.split(/\s+/);
  if (speciesOnly) return parts.length === 1 ? { query: `${fields[2]} LIKE ${literal(term + "%")}`, projection: fields, term, kind, speciesOnly } : null;
  if (parts.length > 2) return null;
  return { query: `${fields[1]} = ${literal(parts[0])}` + (parts[1] ? ` AND ${fields[2]} LIKE ${literal(parts[1] + "%")}` : ""), projection: fields, term, kind };
}
export type LookupRequest = NonNullable<ReturnType<typeof lookupRequest>>;
export function scheduleLookup<T>(load: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void, reject: (error: unknown) => void, delay = 300) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    void load(controller.signal).then(value => { if (!controller.signal.aborted) accept(value); }).catch(error => { if (!controller.signal.aborted) reject(error); });
  }, delay);
  return () => { controller.abort(); clearTimeout(timer); };
}
export function schemaColumns(value: unknown): Set<string> {
  const metadata = (value as { metadata?: { column: string }[] })?.metadata;
  if (!Array.isArray(metadata) || metadata.length > 1000 || metadata.some(column => typeof column?.column !== "string")) throw new Error("Search schema is unavailable.");
  return new Set(metadata.map(column => column.column));
}
export function lookupCandidates(value: unknown, request: LookupRequest): { candidates: Candidate[]; prediction?: Candidate; omitted: boolean } {
  const schema = schemaColumns(value);
  if (request.projection.some(column => !schema.has(column))) throw new Error("Search schema lacks this field's required columns.");
  const rows = (value as { data?: Record<string, unknown>[] }).data;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error("Too many search rows; narrow the filter. No prediction made.");
  const candidates = new Map<string, Candidate>();
  for (const row of rows) {
    if (!row || request.projection.some(column => typeof row[column] !== "string")) throw new Error("Invalid identity search row.");
    const id = (row[request.projection[0]] as string).trim();
    const names = request.kind === "chemical" ? (row[request.projection[1]] as string).split("=") : [`${row[request.projection[1]]} ${row[request.projection[2]]}`.trim()];
    if (!id || id.length > 500 || names.some(name => name.length > 10000)) continue;
    const exact = !request.speciesOnly && names.some(name => normalized(name) === normalized(request.term));
    const previous = candidates.get(id);
    candidates.set(id, { id, name: names.join("; "), exact: exact || !!previous?.exact });
  }
  const all = [...candidates.values()];
  const exact = all.filter(candidate => candidate.exact);
  const truncated = (value as { truncated?: boolean }).truncated;
  if (truncated !== undefined && typeof truncated !== "boolean") throw new Error("Invalid search completeness flag.");
  return { candidates: all.slice(0, MAX_RESULTS), prediction: !truncated && exact.length === 1 ? exact[0] : undefined, omitted: !!truncated || all.length > MAX_RESULTS };
}

export type CellValue = { id: string; name?: string; manual: boolean };
export function predictedValue(current: CellValue | undefined, prediction?: Candidate): CellValue {
  return current?.manual ? current : { id: prediction?.id ?? "", name: prediction?.name, manual: false };
}
export function exportPayload(columns: ExportColumn[], rows: Record<string, string>[], headers: boolean) {
  const clean = (value: string) => { const text = Array.from(value, char => char.charCodeAt(0) < 32 ? " " : char).join(""); return /^\s*[=+@-]/.test(text) ? "'" + text : text; };
  const lines = rows.map(row => columns.map(column => clean(row[column.name] ?? "")));
  if (headers) lines.unshift(columns.map(column => column.name));
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return { text: lines.map(line => line.join("\t")).join("\r\n"), html: `<table><tbody>${lines.map(line => `<tr>${line.map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>` };
}

export async function copyExport(payload: { text: string; html: string }, select: () => void): Promise<"rich" | "text"> {
  let populated = false;
  const listener = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    try { event.clipboardData.setData("text/plain", payload.text); event.clipboardData.setData("text/html", payload.html); populated = true; } catch { /* Try the clipboard API. */ }
  };
  document.addEventListener("copy", listener);
  try { select(); if (document.execCommand?.("copy") === true && populated) return "rich"; }
  catch { /* Try the clipboard API. */ }
  finally { document.removeEventListener("copy", listener); }
  const clipboard = navigator.clipboard;
  if (clipboard?.write && typeof ClipboardItem === "function") {
    try { await clipboard.write([new ClipboardItem({ "text/html": new Blob([payload.html], { type: "text/html" }), "text/plain": new Blob([payload.text], { type: "text/plain" }) })]); return "rich"; }
    catch { /* Plain-text copy may still be available. */ }
  }
  if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
  await clipboard.writeText(payload.text);
  return "text";
}

export function downloadExport(text: string) {
  const link = document.createElement("a");
  let url: string | undefined;
  try { url = URL.createObjectURL(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" })); link.href = url; link.download = "main-draft.tsv"; document.body.append(link); link.click(); }
  finally { link.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url!), 60000); }
}
