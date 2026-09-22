export type OmicsType = "genome" | "chloroplast-genome" | "mitochondrial-genome" | "transcriptome" | "sequencing-library" | "expression" | "proteome" | "metabolome";
export type OmicsSource = "ncbi" | "ena" | "uniprot" | "geo" | "biostudies" | "ensembl-plants" | "pride" | "metabolights";
export type OmicsStatus = "loading" | "ready" | "error" | "ambiguous";

export type OmicsTaxon = { rank: number; name: string; title: string; id?: string };
export type ProviderTaxon = { taxId: string; scientificName: string; rank?: string };
export type OmicsCount = {
  source: OmicsSource;
  type: OmicsType;
  providerTaxonId?: string;
  count: number | null;
  status: OmicsStatus;
  countedAt: string;
  message?: string;
};
export type OmicsRecord = { accession: string; label: string; species?: string; href: string };

const ENA = "https://www.ebi.ac.uk/ena";
const NCBI_DATASETS = "https://api.ncbi.nlm.nih.gov/datasets/v2";
const NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT = "https://rest.uniprot.org";
const ENSEMBL = "https://rest.ensembl.org";
const TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const PREVIEW_SIZE = 3;
const MAX_LIST_SIZE = 300;
const PAGE_SIZE = 100;
const METABOLIGHTS_PAGE_SIZE = 10;
const EUTILS_MIN_START_INTERVAL_MS = 350;
let nextEutilsStart = 0;
let eutilsTurn: Promise<void> = Promise.resolve();

export function sourcesFor(type: OmicsType, taxon?: OmicsTaxon): OmicsSource[] {
  switch (type) {
    case "genome": return ["ncbi", "ena"];
    case "chloroplast-genome":
    case "mitochondrial-genome": return ["ncbi"];
    case "transcriptome":
    case "sequencing-library": return ["ncbi", "ena"];
    // BioStudies / ArrayExpress documents an exact organism-name filter but
    // no descendant expansion, so it is intentionally species-only.
    case "expression": return taxon && isGroup(taxon) ? ["geo"] : ["geo", "biostudies"];
    case "proteome": return ["uniprot"];
    case "metabolome": return taxon && isGroup(taxon) ? [] : ["metabolights"];
  }
}
/** Optional sources are not selected initially, so a slow third party cannot delay the established checks. */
export function optionalSourcesFor(type: OmicsType, taxon?: OmicsTaxon): OmicsSource[] {
  if (type === "genome") return ["ensembl-plants"];
  // PRIDE exposes exact indexed organism labels but no documented descendants.
  if (type === "proteome" && taxon && !isGroup(taxon)) return ["pride"];
  return [];
}
/** These providers are visible with a direct source link, but lack a verified exact, browser-safe taxon count. */
export function unavailableSourcesFor(type: OmicsType, taxon?: OmicsTaxon): OmicsSource[] {
  if (type === "expression" && taxon && isGroup(taxon)) return ["biostudies"];
  if (type === "proteome" && taxon && isGroup(taxon)) return ["pride"];
  if (type === "metabolome" && taxon && isGroup(taxon)) return ["metabolights"];
  return [];
}

export function isGroup(taxon: OmicsTaxon): boolean {
  return taxon.rank > 0;
}
export function canLoadPreviews(counts: Pick<OmicsCount, "count" | "status">[]): boolean {
  return counts.length > 0 && counts.every(count => count.status === "ready" && Number.isSafeInteger(count.count) && (count.count ?? 0) >= 0)
    && counts.reduce((total, count) => total + (count.count ?? 0), 0) <= 300;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) search.set(key, String(value)); });
  return search.toString();
}

function requestedListSize(expectedCount?: number): number {
  const size = expectedCount ?? PREVIEW_SIZE;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LIST_SIZE) throw new Error("External result list size is invalid");
  return size;
}
function completeRecords(records: OmicsRecord[], expectedCount?: number, unique = false): OmicsRecord[] {
  if (expectedCount !== undefined && (records.length !== expectedCount || (unique && new Set(records.map(record => record.accession)).size !== records.length))) throw new Error("External provider returned an incomplete result list");
  return records;
}

/** Browser-only fetch: it deliberately never uses the application's API client or credentials. */
async function externalResponse(url: string, signal?: AbortSignal, request?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ text: string; headers: Headers }> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(new DOMException("External provider timed out", "TimeoutError")), TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(url, { credentials: "omit", redirect: "error", signal: combined, method: request?.method, body: request?.body, headers: { Accept: "application/json", ...request?.headers } });
    if (!response.ok) throw new Error(`External provider returned ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error("External provider response was too large");
    if (!response.body) throw new Error("External provider returned an empty response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("External provider response was too large"); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return { text: new TextDecoder().decode(bytes), headers: response.headers };
  } finally {
    window.clearTimeout(timer);
  }
}
export async function externalJson(url: string, signal?: AbortSignal): Promise<unknown> { return JSON.parse((await externalResponse(url, signal)).text); }
async function externalJsonPost(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const encoded = JSON.stringify(body);
  return JSON.parse((await externalResponse(url, signal, { method: "POST", body: encoded, headers: { "Content-Type": "application/json" } })).text);
}
async function externalText(url: string, signal?: AbortSignal): Promise<string> { return (await externalResponse(url, signal)).text; }
async function eutilsJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let release!: () => void;
  const previous = eutilsTurn;
  eutilsTurn = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    const wait = nextEutilsStart - Date.now();
    if (wait > 0) await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, wait);
      const abort = () => { window.clearTimeout(timer); reject(signal?.reason ?? new DOMException("External provider request was cancelled", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (signal?.aborted) throw signal.reason ?? new DOMException("External provider request was cancelled", "AbortError");
    nextEutilsStart = Date.now() + EUTILS_MIN_START_INTERVAL_MS;
  } finally {
    release();
  }
  return externalJson(url, signal);
}

/** ENA uses the NCBI taxonomy; exact equality avoids silently guessing a taxon. */
export async function resolveProviderTaxa(name: string, signal?: AbortSignal): Promise<ProviderTaxon[]> {
  const rows = await externalJson(`${ENA}/taxonomy/rest/scientific-name/${encodeURIComponent(name)}`, signal);
  if (!Array.isArray(rows)) throw new Error("ENA taxonomy returned an unexpected response");
  return rows.filter(row => row?.scientificName === name && row?.taxId != null)
    .map(row => ({ taxId: String(row.taxId), scientificName: row.scientificName, rank: row.rank }));
}

function enaResult(type: OmicsType): string {
  if (type === "genome") return "assembly";
  if (type === "transcriptome") return "tsa_set";
  return "read_experiment";
}
function taxonExpression(taxon: OmicsTaxon, taxId: string): string {
  return `${isGroup(taxon) ? "tax_tree" : "tax_eq"}(${taxId})`;
}
async function enaCount(taxon: OmicsTaxon, taxId: string, type: OmicsType, signal?: AbortSignal): Promise<number> {
  const text = await externalText(`${ENA}/portal/api/count?${query({ result: enaResult(type), query: taxonExpression(taxon, taxId) })}`, signal);
  const match = /^count\s*\r?\n(\d+)\s*$/i.exec(text);
  if (!match) throw new Error("ENA count returned an unexpected response");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("ENA count returned an invalid total");
  return count;
}

async function enaPreview(taxon: OmicsTaxon, taxId: string, type: OmicsType, size: number, signal?: AbortSignal): Promise<OmicsRecord[]> {
  const fields = type === "sequencing-library" ? "experiment_accession,study_title,scientific_name" : "accession,scientific_name";
  const records: OmicsRecord[] = [];
  for (let offset = 0; offset < size; offset += PAGE_SIZE) {
    const body = await externalJson(`${ENA}/portal/api/search?${query({ result: enaResult(type), query: taxonExpression(taxon, taxId), format: "json", fields, limit: Math.min(PAGE_SIZE, size - offset), offset })}`, signal);
    if (!Array.isArray(body)) throw new Error("ENA search returned an unexpected response");
    records.push(...body.map(row => {
      const accession = String(row.accession ?? row.experiment_accession ?? "");
      return { accession, species: row.scientific_name, label: String(row.description ?? row.study_title ?? accession), href: `https://www.ebi.ac.uk/ena/browser/view/${encodeURIComponent(accession)}` };
    }).filter(row => row.accession));
    if (body.length < Math.min(PAGE_SIZE, size - offset)) break;
  }
  return records;
}

function ncbiTerm(taxon: OmicsTaxon, taxId: string): string {
  void taxon;
  return `txid${taxId}[Organism:exp]`;
}
async function entrezSearch(db: string, term: string, signal?: AbortSignal, size = PREVIEW_SIZE): Promise<{ count: number; ids: string[] }> {
  const body = await eutilsJson(`${NCBI_EUTILS}/esearch.fcgi?${query({ db, term, retmode: "json", retmax: size })}`, signal);
  const result = (body as { esearchresult?: { count?: unknown; idlist?: unknown; errorlist?: { phrasesnotfound?: unknown; fieldsnotfound?: unknown } } }).esearchresult;
  const errors = [result?.errorlist?.phrasesnotfound, result?.errorlist?.fieldsnotfound].flatMap(value => Array.isArray(value) ? value : []);
  if (errors.length) throw new Error("NCBI search did not accept the taxonomy query");
  const count = Number(result?.count);
  if (!result || !Number.isSafeInteger(count) || count < 0) throw new Error("NCBI search returned an unexpected response");
  return { count, ids: Array.isArray(result.idlist) ? result.idlist.map(String) : [] };
}
async function ncbiSummary(db: string, ids: string[], signal?: AbortSignal): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const body = await eutilsJson(`${NCBI_EUTILS}/esummary.fcgi?${query({ db, id: ids.slice(start, start + PAGE_SIZE).join(","), retmode: "json" })}`, signal);
    const result = body as { result?: { uids?: string[] } & Record<string, unknown> };
    rows.push(...(result.result?.uids ?? []).map(id => result.result?.[id]).filter(Boolean));
  }
  return rows;
}
async function ncbiGenome(taxId: string, size: number, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  const records: OmicsRecord[] = [];
  let token: string | undefined;
  let total: number | undefined;
  const tokens = new Set<string>();
  let pages = 0;
  do {
    if (++pages > Math.ceil(size / PAGE_SIZE)) break;
    const body = await externalJson(`${NCBI_DATASETS}/genome/taxon/${encodeURIComponent(taxId)}/dataset_report?${query({ page_size: Math.min(PAGE_SIZE, size - records.length), page_token: token })}`, signal) as { total_count?: unknown; reports?: unknown[]; next_page_token?: unknown };
    if (!Number.isSafeInteger(body?.total_count) || (body.total_count as number) < 0 || !Array.isArray(body?.reports)) throw new Error("NCBI Datasets returned an unexpected response");
    if (total === undefined) total = body.total_count as number;
    else if (total !== body.total_count) throw new Error("NCBI Datasets changed while loading results");
    records.push(...body.reports.map(report => { const item = report as { accession?: unknown; assembly_info?: { assembly_name?: unknown }; organism?: { organism_name?: string } }; const accession = String(item.accession ?? ""); return { accession, label: String(item.assembly_info?.assembly_name ?? accession), species: item.organism?.organism_name, href: `https://www.ncbi.nlm.nih.gov/datasets/genome/${encodeURIComponent(accession)}/` }; }).filter((record: OmicsRecord) => record.accession));
    token = typeof body.next_page_token === "string" && body.next_page_token ? body.next_page_token : undefined;
    if (token) {
      if (tokens.has(token)) throw new Error("NCBI Datasets returned a repeated pagination token");
      tokens.add(token);
    }
    if (records.length < size && !token) break;
  } while (records.length < size);
  return { count: total ?? 0, records };
}
async function ncbiEntrez(taxon: OmicsTaxon, taxId: string, type: OmicsType, size: number, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  const db = type === "sequencing-library" ? "sra" : "nuccore";
  const term = ncbiQuery(taxon, taxId, type);
  const search = await entrezSearch(db, term, signal, size);
  const summaries = await ncbiSummary(db, search.ids, signal);
  return { count: search.count, records: summaries.map(row => { const item = row as Record<string, unknown>; const accession = String(item.accessionversion ?? item.accession ?? item.uid ?? ""); return { accession, label: String(item.title ?? accession), species: typeof item.organism === "string" ? item.organism : undefined, href: `https://www.ncbi.nlm.nih.gov/${db}/?term=${encodeURIComponent(String(item.uid ?? accession))}` }; }).filter(record => record.accession) };
}
function ncbiQuery(taxon: OmicsTaxon, taxId: string, type: OmicsType): string {
  const scope = ncbiTerm(taxon, taxId);
  if (type === "transcriptome") return `${scope} AND tsa[filter]`;
  if (type === "chloroplast-genome") return `${scope} AND chloroplast[filter]`;
  if (type === "mitochondrial-genome") return `${scope} AND mitochondrion[filter]`;
  return scope;
}
function geoQuery(taxon: OmicsTaxon): string {
  return `"${taxon.title.trim()}"[Organism] AND gse[Entry Type]`;
}
async function geo(taxon: OmicsTaxon, size: number, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  const search = await entrezSearch("gds", geoQuery(taxon), signal, size);
  const summaries = await ncbiSummary("gds", search.ids, signal);
  return {
    count: search.count,
    records: summaries.map(row => {
      const item = row as Record<string, unknown>;
      const accession = String(item.accession ?? "");
      return { accession, label: String(item.title ?? accession), species: typeof item.taxon === "string" ? item.taxon : undefined, href: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(accession)}` };
    }).filter(record => record.accession),
  };
}
type BioStudiesSearch = { totalHits?: unknown; isTotalHitsExact?: unknown; hits?: unknown[] };
async function bioStudies(taxon: OmicsTaxon, size = PREVIEW_SIZE, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  if (isGroup(taxon)) throw new Error("BioStudies / ArrayExpress does not document descendant taxonomy expansion");
  const records: OmicsRecord[] = [];
  let count: number | undefined;
  const pageSize = Math.min(PAGE_SIZE, size);
  for (let page = 1; records.length < size && page <= Math.ceil(size / pageSize); page++) {
    const body = await externalJson(`https://www.ebi.ac.uk/biostudies/api/v1/arrayexpress/search?${query({ organism: taxon.title.trim(), pageSize, page })}`, signal) as BioStudiesSearch;
    const total = Number(body.totalHits);
    if (body.isTotalHitsExact !== true || !Number.isSafeInteger(total) || total < 0 || !Array.isArray(body.hits)) throw new Error("BioStudies / ArrayExpress did not provide an exact total count");
    if (count === undefined) count = total;
    else if (count !== total) throw new Error("BioStudies / ArrayExpress changed while loading results");
    records.push(...body.hits.map(row => {
      const item = row as { accession?: unknown; title?: unknown; organism?: unknown };
      const accession = String(item.accession ?? "");
      return { accession, label: String(item.title ?? accession), species: typeof item.organism === "string" ? item.organism : taxon.title.trim(), href: `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${encodeURIComponent(accession)}` };
    }).filter(record => record.accession));
    if (body.hits.length < pageSize) break;
  }
  return { count: count ?? 0, records };
}
type MetaboLightsSearch = { content?: { totalResults?: unknown; studies?: unknown[]; results?: unknown[] } };
function metaboLightsRequest(taxon: OmicsTaxon, size: number, page = 1) {
  return { version: "v1", query_text: null, inter_field_combiner: "AND", page: { current: page, size }, sort: [], clauses: [{ kind: "terms", field_id: "facet_organisms", op: "OR", not: false, terms: [taxon.title.trim()], match: "EXACT" }] };
}
type PrideProject = { accession?: unknown; title?: unknown; organisms?: unknown };
async function pride(taxon: OmicsTaxon, size: number, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  if (isGroup(taxon)) throw new Error("PRIDE does not document descendant taxonomy expansion");
  const records: OmicsRecord[] = [];
  let count: number | undefined;
  const pageSize = Math.min(10, size);
  for (let page = 0; records.length < size && page < Math.ceil(size / pageSize); page++) {
    const response = await externalResponse(`https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?${query({ filter: `organisms==${taxon.title.trim()}`, pageSize, page })}`, signal);
    const total = Number(response.headers.get("total_records"));
    const body = JSON.parse(response.text) as unknown;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(body)) throw new Error("PRIDE did not provide an exact total count");
    if (count === undefined) count = total;
    else if (count !== total) throw new Error("PRIDE changed while loading results");
    records.push(...body.map(row => {
    const item = row as PrideProject;
    const accession = String(item.accession ?? "");
    return { accession, label: String(item.title ?? accession), species: Array.isArray(item.organisms) ? item.organisms.map(String).join(", ") : taxon.title.trim(), href: `https://www.ebi.ac.uk/pride/archive/projects/${encodeURIComponent(accession)}` };
    }).filter(record => record.accession));
    if (body.length < pageSize) break;
  }
  return { count: count ?? 0, records };
}
async function metaboLights(taxon: OmicsTaxon, size: number, signal?: AbortSignal): Promise<{ count: number; records: OmicsRecord[] }> {
  if (isGroup(taxon)) throw new Error("MetaboLights does not document descendant taxonomy expansion");
  const records: OmicsRecord[] = [];
  let count: number | undefined;
  const pageSize = Math.min(METABOLIGHTS_PAGE_SIZE, size);
  for (let page = 1; records.length < size && page <= Math.ceil(size / pageSize); page++) {
    const body = await externalJsonPost("https://www.ebi.ac.uk/metabolights/ws3/public/v2/public-study-index/advanced-search?include_all_ids=true", metaboLightsRequest(taxon, pageSize, page), signal) as MetaboLightsSearch;
    const total = Number(body.content?.totalResults);
    const studies = body.content?.studies ?? body.content?.results;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(studies)) throw new Error("MetaboLights did not provide an exact total count");
    if (count === undefined) count = total;
    else if (count !== total) throw new Error("MetaboLights changed while loading results");
    records.push(...studies.map(row => {
    const item = row as { studyId?: unknown; accession?: unknown; title?: unknown; organisms?: unknown };
    const accession = String(item.studyId ?? item.accession ?? "");
    return { accession, label: String(item.title ?? accession), species: Array.isArray(item.organisms) ? item.organisms.map(String).join(", ") : taxon.title.trim(), href: `https://www.ebi.ac.uk/metabolights/${encodeURIComponent(accession)}` };
    }).filter(record => record.accession));
    if (studies.length < pageSize) break;
  }
  return { count: count ?? 0, records };
}

type EnsemblGenome = { division?: unknown; name?: unknown; url_name?: unknown; display_name?: unknown; scientific_name?: unknown };
async function ensemblPlants(taxId: string, signal?: AbortSignal): Promise<OmicsRecord[]> {
  const body = await externalJson(`${ENSEMBL}/info/genomes/taxonomy/${encodeURIComponent(taxId)}?content-type=application/json`, signal);
  if (!Array.isArray(body)) throw new Error("Ensembl taxonomy genomes returned an unexpected response");
  return body.filter((row): row is EnsemblGenome => typeof row === "object" && row !== null)
    .filter(row => row.division === "EnsemblPlants" && typeof row.name === "string" && row.name)
    .map(row => {
      const accession = row.name as string;
      const path = typeof row.url_name === "string" && row.url_name ? row.url_name : accession;
      return { accession, label: String(row.display_name ?? row.scientific_name ?? accession), species: typeof row.scientific_name === "string" ? row.scientific_name : undefined, href: `https://plants.ensembl.org/${encodeURIComponent(path)}/Info/Index` };
    });
}

function unsupportedTaxonomyCount(source: OmicsSource): never {
  const provider = source === "geo" ? "GEO" : source === "biostudies" ? "BioStudies / ArrayExpress" : source === "pride" ? "PRIDE" : "MetaboLights";
  throw new Error(`${provider} does not expose a trustworthy NCBI-taxon scoped count in its public browser API`);
}
/** Count endpoints run before any preview list. A missing/malformed total is an error, never zero. */
export async function countSource(taxon: OmicsTaxon, source: OmicsSource, type: OmicsType, taxId: string, signal?: AbortSignal): Promise<number> {
  if (source === "ena") return enaCount(taxon, taxId, type, signal);
  if (source === "ensembl-plants") return (await ensemblPlants(taxId, signal)).length;
  if (source === "geo") return (await entrezSearch("gds", geoQuery(taxon), signal)).count;
  if (source === "biostudies") return (await bioStudies(taxon, 1, signal)).count;
  if (source === "metabolights") return (await metaboLights(taxon, 1, signal)).count;
  if (source === "pride") return (await pride(taxon, 1, signal)).count;
  if (source === "ncbi" && type !== "genome") return (await entrezSearch(type === "sequencing-library" ? "sra" : "nuccore", ncbiQuery(taxon, taxId, type), signal)).count;
  if (source === "ncbi") {
    const body = await externalJson(`${NCBI_DATASETS}/genome/taxon/${encodeURIComponent(taxId)}/dataset_report?${query({ page_size: 1 })}`, signal) as { total_count?: unknown };
    // Datasets serializes a valid empty protobuf report as `{}`; any nonempty shape
    // without total_count remains an unavailable count rather than a guessed zero.
    if (typeof body === "object" && body !== null && !Array.isArray(body) && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 0) return 0;
    if (!Number.isSafeInteger(body?.total_count) || (body.total_count as number) < 0) throw new Error("NCBI Datasets did not provide a total count");
    return body.total_count as number;
  }
  if (source !== "uniprot") return unsupportedTaxonomyCount(source);
  const response = await externalResponse(`${UNIPROT}/proteomes/search?${query({ query: `taxonomy_id:${taxId}`, format: "json", size: 1 })}`, signal);
  const total = response.headers.get("x-total-results");
  if (total === null) throw new Error("UniProt did not provide a total count");
  const count = Number(total);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("UniProt did not provide a total count");
  return count;
}

export async function previewSource(taxon: OmicsTaxon, source: OmicsSource, type: OmicsType, taxId: string, signal?: AbortSignal, expectedCount?: number): Promise<OmicsRecord[]> {
  const size = requestedListSize(expectedCount);
  if (size === 0) return [];
  if (source === "ena") return completeRecords(await enaPreview(taxon, taxId, type, size, signal), expectedCount);
  if (source === "ensembl-plants") return completeRecords((await ensemblPlants(taxId, signal)).slice(0, size), expectedCount, true);
  if (source === "geo") { const result = await geo(taxon, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("GEO changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source === "biostudies") { const result = await bioStudies(taxon, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("BioStudies / ArrayExpress changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source === "metabolights") { const result = await metaboLights(taxon, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("MetaboLights changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source === "pride") { const result = await pride(taxon, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("PRIDE changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source === "ncbi" && type === "genome") { const result = await ncbiGenome(taxId, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("NCBI Datasets changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source === "ncbi") { const result = await ncbiEntrez(taxon, taxId, type, size, signal); if (expectedCount !== undefined && result.count !== expectedCount) throw new Error("NCBI changed while loading results"); return completeRecords(result.records, expectedCount, true); }
  if (source !== "uniprot") return unsupportedTaxonomyCount(source);
  const records: OmicsRecord[] = [];
  const pageSize = Math.min(PAGE_SIZE, size);
  let next = `${UNIPROT}/proteomes/search?${query({ query: `taxonomy_id:${taxId}`, format: "json", size: pageSize })}`;
  let total: number | undefined;
  const cursors = new Set<string>();
  let pages = 0;
  while (next && records.length < size && ++pages <= Math.ceil(size / pageSize)) {
    const response = await externalResponse(next, signal);
    const body = JSON.parse(response.text) as { results?: unknown[] };
    const reportedTotal = Number(response.headers.get("x-total-results"));
    if (!Number.isSafeInteger(reportedTotal) || reportedTotal < 0 || !Array.isArray(body?.results)) throw new Error("UniProt returned an unexpected response");
    if (total === undefined) total = reportedTotal;
    else if (total !== reportedTotal) throw new Error("UniProt changed while loading results");
    records.push(...body.results.map(row => { const item = row as { id?: unknown; description?: unknown; taxon?: { scientificName?: string } }; const accession = String(item.id ?? ""); return { accession, label: String(item.description ?? accession), species: item.taxon?.scientificName, href: `https://www.uniprot.org/proteomes/${encodeURIComponent(accession)}` }; }).filter((record: OmicsRecord) => record.accession));
    const link = response.headers.get("link");
    const match = link && /<([^>]+)>;\s*rel="next"/.exec(link);
    if (!match) break;
    const continuation = new URL(match[1]);
    if (continuation.origin !== UNIPROT || continuation.pathname !== "/proteomes/search") throw new Error("UniProt returned an unsafe pagination link");
    const cursor = continuation.searchParams.get("cursor");
    if (!cursor) throw new Error("UniProt returned an invalid pagination link");
    if (cursors.has(cursor)) throw new Error("UniProt returned a repeated pagination cursor");
    cursors.add(cursor);
    next = `${UNIPROT}/proteomes/search?${query({ query: `taxonomy_id:${taxId}`, format: "json", size: pageSize, cursor })}`;
  }
  if (expectedCount !== undefined && total !== expectedCount) throw new Error("UniProt changed while loading results");
  return completeRecords(records, expectedCount, true);
}
