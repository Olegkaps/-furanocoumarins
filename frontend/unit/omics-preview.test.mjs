import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
after(() => server.close());
const omics = await server.ssrLoadModule("/src/TaxonPage/omics.ts");
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { setTimeout, clearTimeout };
after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });

test("external taxonomy only accepts exact scientific-name records", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([{ taxId: "1", scientificName: "Prangos heyniae" }, { taxId: "2", scientificName: "Prangos heynia" }]));
  assert.deepEqual(await omics.resolveProviderTaxa("Prangos heyniae"), [{ taxId: "1", scientificName: "Prangos heyniae", rank: undefined }]);
});

test("source choices do not claim UniProt covers nucleotide record types", () => {
  assert.deepEqual(omics.sourcesFor("genome"), ["ncbi", "ena"]);
  assert.deepEqual(omics.optionalSourcesFor("genome"), ["ensembl-plants"]);
  assert.deepEqual(omics.sourcesFor("proteome"), ["uniprot"]);
});

test("ENA malformed count responses are unknown rather than silently zero", async () => {
  globalThis.fetch = async () => new Response("count\nnot-a-number");
  await assert.rejects(omics.countSource({ rank: 1, name: "Prangos", title: "Prangos" }, "ena", "genome", "1925582"), /unexpected response/);
});

test("NCBI Datasets' documented empty report is an exact zero, while other missing totals fail", async () => {
  globalThis.fetch = async () => new Response("{}");
  assert.equal(await omics.countSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582"), 0);
  globalThis.fetch = async () => new Response(JSON.stringify({ reports: [] }));
  await assert.rejects(omics.countSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582"), /total count/);
  globalThis.fetch = async () => new Response("[]");
  await assert.rejects(omics.countSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582"), /total count/);
});

test("preview requests are separate from count requests, so callers can enforce the aggregate cap", async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return new Response("count\n0"); };
  await omics.countSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ena", "genome", "1925582");
  assert.equal(urls.some(url => url.includes("/portal/api/search")), false);
});

test("sequencing-library count uses ENA experiments and the provider tax tree for groups", async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return new Response("count\n12"); };
  assert.equal(await omics.countSource({ rank: 2, name: "Apiaceae", title: "Apiaceae" }, "ena", "sequencing-library", "4801"), 12);
  assert.match(urls[0], /\/portal\/api\/count/);
  assert.match(urls[0], /result=read_experiment/);
  assert.match(decodeURIComponent(urls[0]), /tax_tree\(4801\)/);
});

test("NCBI organelle categories use bounded Nucleotide searches, not assembly totals", async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return new Response(JSON.stringify({ esearchresult: { count: "4", idlist: [] } })); };
  assert.equal(await omics.countSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "chloroplast-genome", "1925582"), 4);
  assert.match(urls[0], /db=nuccore/);
  assert.match(decodeURIComponent(urls[0]), /chloroplast\[filter\]/);
});

test("GEO counts only series through its documented Organism field", async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return new Response(JSON.stringify({ esearchresult: { count: "2", idlist: [] } })); };
  assert.equal(await omics.countSource({ rank: 1, name: "Apiaceae", title: "Apiaceae" }, "geo", "expression", "4801"), 2);
  assert.equal(new URL(urls[0]).searchParams.get("term"), '"Apiaceae"[Organism] AND gse[Entry Type]');
});

test("GEO and BioStudies previews retain zero counts and stable study links", async () => {
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes("biostudies")) return new Response(JSON.stringify({ totalHits: 1, isTotalHitsExact: true, hits: [{ accession: "E-MTAB-1", title: "Expression study" }] }));
    if (value.includes("esummary")) return new Response(JSON.stringify({ result: { uids: ["1"], "1": { accession: "GSE1", title: "GEO study", taxon: "Apiaceae" } } }));
    return new Response(JSON.stringify({ esearchresult: { count: "1", idlist: ["1"] } }));
  };
  const taxon = { rank: 0, name: "heyniae", title: "Prangos heyniae" };
  assert.deepEqual(await omics.previewSource(taxon, "geo", "expression", "1925582"), [{ accession: "GSE1", label: "GEO study", species: "Apiaceae", href: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE1" }]);
  assert.deepEqual(await omics.previewSource(taxon, "biostudies", "expression", "1925582"), [{ accession: "E-MTAB-1", label: "Expression study", species: "Prangos heyniae", href: "https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-MTAB-1" }]);
  globalThis.fetch = async () => new Response(JSON.stringify({ totalHits: 0, isTotalHitsExact: false, hits: [] }));
  await assert.rejects(omics.countSource(taxon, "biostudies", "expression", "1925582"), /exact total count/);
});

test("unsupported provider counts stay unknown and group BioStudies is excluded", async () => {
  await assert.rejects(omics.countSource({ rank: 1, name: "X", title: "X" }, "biostudies", "expression", "1"), /descendant/);
  assert.deepEqual(omics.sourcesFor("expression", { rank: 1, name: "Apiaceae", title: "Apiaceae" }), ["geo"]);
});

test("MetaboLights uses its exact organism facet only for a species", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ content: { totalResults: 1, studies: [{ studyId: "MTBLS1", title: "Metabolomics study", organisms: ["Prangos heyniae"] }] } }));
  };
  const taxon = { rank: 0, name: "heyniae", title: "Prangos heyniae" };
  assert.equal(await omics.countSource(taxon, "metabolights", "metabolome", ""), 1);
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body).clauses[0], { kind: "terms", field_id: "facet_organisms", op: "OR", not: false, terms: ["Prangos heyniae"], match: "EXACT" });
  assert.deepEqual(await omics.previewSource(taxon, "metabolights", "metabolome", ""), [{ accession: "MTBLS1", label: "Metabolomics study", species: "Prangos heyniae", href: "https://www.ebi.ac.uk/metabolights/MTBLS1" }]);
  await assert.rejects(omics.countSource({ rank: 1, name: "Apiaceae", title: "Apiaceae" }, "metabolights", "metabolome", ""), /descendant/);
});

test("PRIDE uses its exact organism filter and exposed project total", async () => {
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify([{ accession: "PXD1", title: "Experimental proteomics", organisms: ["Prangos heyniae"] }]), { headers: { total_records: "1" } });
  };
  const taxon = { rank: 0, name: "heyniae", title: "Prangos heyniae" };
  assert.equal(await omics.countSource(taxon, "pride", "proteome", ""), 1);
  assert.equal(new URL(urls[0]).searchParams.get("filter"), "organisms==Prangos heyniae");
  assert.deepEqual(await omics.previewSource(taxon, "pride", "proteome", ""), [{ accession: "PXD1", label: "Experimental proteomics", species: "Prangos heyniae", href: "https://www.ebi.ac.uk/pride/archive/projects/PXD1" }]);
  assert.deepEqual(omics.optionalSourcesFor("proteome", taxon), ["pride"]);
  await assert.rejects(omics.countSource({ rank: 1, name: "Apiaceae", title: "Apiaceae" }, "pride", "proteome", ""), /descendant/);
});

test("NCBI Datasets loads a counted list across its continuation pages", async () => {
  const urls = [];
  globalThis.fetch = async url => {
    const value = String(url);
    urls.push(value);
    const params = new URL(value).searchParams;
    const start = params.get("page_token") === "second" ? 100 : 0;
    const reports = Array.from({ length: start ? 1 : 100 }, (_, index) => ({ accession: `GCF_${start + index}`, assembly_info: { assembly_name: `assembly-${start + index}` }, organism: { organism_name: "Prangos heyniae" } }));
    return new Response(JSON.stringify({ total_count: 101, reports, ...(start ? {} : { next_page_token: "second" }) }));
  };
  const records = await omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582", undefined, 101);
  assert.equal(records.length, 101);
  assert.equal(records.at(-1).accession, "GCF_100");
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).searchParams.get("page_size"), "100");
  assert.equal(new URL(urls[1]).searchParams.get("page_token"), "second");
});

test("complete lists fail rather than rendering a truncated provider page", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ total_count: 4, reports: [{ accession: "GCF_1" }] }));
  await assert.rejects(
    omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582", undefined, 4),
    /incomplete result list/,
  );
});

test("keyed providers reject a repeated accession from a later page", async () => {
  globalThis.fetch = async url => {
    const secondPage = new URL(String(url)).searchParams.get("page_token") === "second";
    const reports = secondPage
      ? [{ accession: "GCF_0" }]
      : Array.from({ length: 100 }, (_, index) => ({ accession: `GCF_${index}` }));
    return new Response(JSON.stringify({ total_count: 101, reports, ...(secondPage ? {} : { next_page_token: "second" }) }));
  };
  await assert.rejects(
    omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582", undefined, 101),
    /incomplete result list/,
  );
});

test("MetaboLights keeps its bounded page size while retrieving the final page", async () => {
  const pages = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    pages.push(request.page);
    const start = (request.page.current - 1) * request.page.size;
    const studies = Array.from({ length: Math.min(request.page.size, 11 - start) }, (_, index) => ({ studyId: `MTBLS${start + index}` }));
    return new Response(JSON.stringify({ content: { totalResults: 11, studies } }));
  };
  const records = await omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "metabolights", "metabolome", "", undefined, 11);
  assert.equal(records.length, 11);
  assert.deepEqual(pages, [{ current: 1, size: 10 }, { current: 2, size: 10 }]);
});

test("provider cursors and indexed pages retrieve the final short page", async () => {
  const taxon = { rank: 0, name: "heyniae", title: "Prangos heyniae" };
  const enaOffsets = [];
  globalThis.fetch = async url => {
    const params = new URL(String(url)).searchParams;
    const offset = Number(params.get("offset"));
    enaOffsets.push(offset);
    return new Response(JSON.stringify(Array.from({ length: offset ? 1 : 100 }, (_, index) => ({ accession: `ERA${offset + index}` }))));
  };
  assert.equal((await omics.previewSource(taxon, "ena", "genome", "1925582", undefined, 101)).length, 101);
  assert.deepEqual(enaOffsets, [0, 100]);

  const bioPages = [];
  globalThis.fetch = async url => {
    const params = new URL(String(url)).searchParams;
    bioPages.push({ page: params.get("page"), size: params.get("pageSize") });
    const start = (Number(params.get("page")) - 1) * 100;
    return new Response(JSON.stringify({ totalHits: 101, isTotalHitsExact: true, hits: Array.from({ length: start ? 1 : 100 }, (_, index) => ({ accession: `E-${start + index}` })) }));
  };
  assert.equal((await omics.previewSource(taxon, "biostudies", "expression", "", undefined, 101)).length, 101);
  assert.deepEqual(bioPages, [{ page: "1", size: "100" }, { page: "2", size: "100" }]);

  const pridePages = [];
  globalThis.fetch = async url => {
    const params = new URL(String(url)).searchParams;
    pridePages.push({ page: params.get("page"), size: params.get("pageSize") });
    const start = Number(params.get("page")) * 10;
    return new Response(JSON.stringify(Array.from({ length: start ? 1 : 10 }, (_, index) => ({ accession: `PXD${start + index}` }))), { headers: { total_records: "11" } });
  };
  assert.equal((await omics.previewSource(taxon, "pride", "proteome", "", undefined, 11)).length, 11);
  assert.deepEqual(pridePages, [{ page: "0", size: "10" }, { page: "1", size: "10" }]);

  let uniprotPage = 0;
  globalThis.fetch = async () => {
    const start = uniprotPage++ * 100;
    return new Response(JSON.stringify({ results: Array.from({ length: start ? 1 : 100 }, (_, index) => ({ id: `UP${start + index}` })) }), { headers: { "x-total-results": "101", ...(start ? {} : { link: '<https://rest.uniprot.org/proteomes/search?cursor=next>; rel="next"' }) } });
  };
  assert.equal((await omics.previewSource(taxon, "uniprot", "proteome", "1925582", undefined, 101)).length, 101);
});

test("UniProt rejects a repeated continuation cursor", async () => {
  let page = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: Array.from({ length: page++ ? 1 : 100 }, (_, index) => ({ id: `UP${page}-${index}` })) }), { headers: { "x-total-results": "101", link: '<https://rest.uniprot.org/proteomes/search?cursor=again>; rel="next"' } });
  await assert.rejects(omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "uniprot", "proteome", "1925582", undefined, 101), /repeated pagination cursor/);
});

test("EUtils summary requests split a complete result list into bounded ID batches", async () => {
  const summaryBatches = [];
  globalThis.fetch = async url => {
    const value = new URL(String(url));
    if (value.pathname.endsWith("esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { count: "101", idlist: Array.from({ length: 101 }, (_, index) => String(index)) } }));
    const ids = value.searchParams.get("id").split(",");
    summaryBatches.push(ids);
    return new Response(JSON.stringify({ result: { uids: ids, ...Object.fromEntries(ids.map(id => [id, { uid: id, accessionversion: `AB${id}` }])) } }));
  };
  const records = await omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "transcriptome", "1925582", undefined, 101);
  assert.equal(records.length, 101);
  assert.deepEqual(summaryBatches.map(batch => batch.length), [100, 1]);
});

test("pagination keeps abort signals and response bounds for external result lists", async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      return new Response(JSON.stringify({ total_count: 101, reports: Array.from({ length: 100 }, (_, index) => ({ accession: `GCF_${index}` })), next_page_token: "second" }));
    }
    if (init.signal.aborted) throw init.signal.reason;
    throw new Error("expected the signal to abort before this request");
  };
  await assert.rejects(
    omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "ncbi", "genome", "1925582", controller.signal, 101),
    /Cancelled/,
  );
  globalThis.fetch = async () => new Response("{}", { headers: { "content-length": String(512 * 1024 + 1) } });
  await assert.rejects(
    omics.previewSource({ rank: 0, name: "heyniae", title: "Prangos heyniae" }, "uniprot", "proteome", "1925582", undefined, 1),
    /too large/,
  );
});

test("EUtils pagination is paced and waiting requests remain cancellable", async () => {
  const starts = [];
  globalThis.fetch = async () => {
    starts.push(Date.now());
    return new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } }));
  };
  const taxon = { rank: 0, name: "heyniae", title: "Prangos heyniae" };
  await Promise.all([
    omics.countSource(taxon, "ncbi", "chloroplast-genome", "1925582"),
    omics.countSource(taxon, "ncbi", "chloroplast-genome", "1925582"),
  ]);
  assert.ok(starts[1] - starts[0] >= 300);
  const controller = new AbortController();
  const request = omics.countSource(taxon, "ncbi", "chloroplast-genome", "1925582", controller.signal);
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(request, /Cancelled/);
  assert.equal(starts.length, 2);
});

test("only complete aggregate counts at or below 300 permit preview requests", () => {
  assert.equal(omics.canLoadPreviews([{ status: "ready", count: 300 }]), true);
  assert.equal(omics.canLoadPreviews([{ status: "ready", count: 301 }]), false);
  assert.equal(omics.canLoadPreviews([{ status: "ready", count: 1 }, { status: "error", count: null }]), false);
  assert.equal(omics.canLoadPreviews([{ status: "loading", count: null }]), false);
});
