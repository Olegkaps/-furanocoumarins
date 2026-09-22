import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
  plugins: [{ name: "omics-mapping-hooks", enforce: "pre", transform(code, id) {
    if (id.endsWith("/TaxonPage/OmicsPreview.tsx")) return code.replace('from "react"', 'from "virtual:omics-hooks"');
  }, resolveId(id, importer) {
    if (id === "virtual:omics-hooks") return "\0omics-hooks";
    if (importer?.endsWith("/TaxonPage/OmicsPreview.tsx") && id === "../shared/api") return "\0omics-api";
    if (importer?.endsWith("/TaxonPage/OmicsPreview.tsx") && id === "./OmicsRecordList") return "\0omics-record-list";
  }, load(id) {
    if (id === "\0omics-hooks") return `export const useState=(...a)=>globalThis.__omicsHooks.useState(...a);export const useEffect=(...a)=>globalThis.__omicsHooks.useEffect(...a);export const useRef=(...a)=>globalThis.__omicsHooks.useRef(...a);export const useCallback=(fn)=>fn;`;
    if (id === "\0omics-api") return `export const api={get:(...a)=>globalThis.__omicsAPI(...a)};`;
    if (id === "\0omics-record-list") return `export default () => null;`;
  } }],
});
after(() => server.close());
const { default: OmicsPreview } = await server.ssrLoadModule("/src/TaxonPage/OmicsPreview.tsx");
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { setTimeout, clearTimeout };
after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });

function text(node) { return node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children); }
function nodes(node) { return node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
async function mount(mapping, fetch, expression = false) {
  const cells = []; let cursor = 0; let effects = []; let tree;
  globalThis.__omicsHooks = {
    useState(initial) { const at = cursor++; cells[at] ??= { value: initial }; return [cells[at].value, next => { cells[at].value = typeof next === "function" ? next(cells[at].value) : next; }]; },
    useRef(initial) { const at = cursor++; cells[at] ??= { current: initial }; return cells[at]; },
    useEffect(effect, deps) { const at = cursor++; if (!cells[at] || deps.some((value, index) => value !== cells[at].deps[index])) { const old = cells[at]; cells[at] = { deps }; effects.push(() => { old?.cleanup?.(); cells[at].cleanup = effect(); }); } },
  };
  globalThis.__omicsAPI = async () => mapping();
  globalThis.fetch = fetch;
  const render = () => { cursor = 0; tree = OmicsPreview({ taxon: { rank: 1, name: "Apiaceae", title: "Apiaceae", id: "local-1" } }); const pending = effects; effects = []; pending.forEach(effect => effect()); };
  render();
  if (expression) nodes(tree).find(node => node.type === "label" && text(node).includes("Expression studies"))?.props.children[0].props.onChange();
  for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); render(); }
  if (expression) { await new Promise(resolve => setTimeout(resolve, 400)); render(); }
  cells.forEach(cell => cell.cleanup?.());
  return text(tree);
}

const ncbiCount = async url => String(url).includes("datasets") ? new Response("{}") : new Response("[]");

test("mapped NCBI survives empty, ambiguous, and failed ENA fallback while missing ENA stays unknown", async () => {
  for (const taxonomy of [new Response("[]"), new Response(JSON.stringify([{ taxId: "1", scientificName: "Apiaceae" }, { taxId: "2", scientificName: "Apiaceae" }])), new Error("ENA down")]) {
    const output = await mount(
      () => Promise.resolve({ data: { version: 4, ids: { ncbi: "4801", ena: "" } } }),
      async url => String(url).includes("scientific-name") ? (taxonomy instanceof Error ? Promise.reject(taxonomy) : taxonomy) : ncbiCount(url),
    );
    assert.match(output, /NCBI: 0/);
    assert.match(output, /ENA: unknown/);
    assert.match(output, /Taxon-ID mapping v4/);
  }
});

test("mapping-service failure still runs exact organism-label sources", async () => {
  const output = await mount(
    () => Promise.reject({ response: { status: 503 } }),
    async url => String(url).includes("esearch.fcgi") ? new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } })) : new Response(JSON.stringify({ totalHits: 0, isTotalHitsExact: true, hits: [] })),
    true,
  );
  assert.match(output, /NCBI GEO: 0/);
  assert.match(output, /BioStudies \/ ArrayExpress: unknown/);
});
