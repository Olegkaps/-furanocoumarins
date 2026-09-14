import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
  plugins: [{ name: "export-controls-fixture", enforce: "pre", transform(code, id) {
    if (id.endsWith("/Admin/PublicationMainExport.tsx")) return code.replaceAll('from "react"', 'from "virtual:export-hooks"');
  }, resolveId(id, importer) {
    if (id === "virtual:export-hooks") return "\0export-hooks";
    if (importer?.endsWith("/Admin/PublicationMainExport.tsx") && id === "../shared/api") return "\0export-api";
  }, load(id) {
    if (id === "\0export-api") return `export const api = { get: (...args) => globalThis.__exportAPI(...args) }; export const getToken = () => 'token';`;
    if (id === "\0export-hooks") return `export const useState = (...args) => globalThis.__exportHooks.useState(...args); export const useEffect = (...args) => globalThis.__exportHooks.useEffect(...args); export const useRef = (...args) => globalThis.__exportHooks.useRef(...args); export const useCallback = (fn) => fn;`;
  } }],
});
after(() => server.close());
const { PublicationMainExport } = await server.ssrLoadModule("/src/Admin/PublicationMainExport.tsx");
const findings = Array.from({ length: 13 }, (_, i) => ({ chemical: `Compound ${i}`, species: "Genus species", methods: [], evidence: [], chirality: "Unknown" }));

test("Resolve IDs covers all 13 selected rows, deduplicates species, exports blanks and cancels late work", async t => {
  const cells = []; let cursor = 0, effects = [], tree, selectedFinding = 0;
  globalThis.__exportHooks = {
    useState(initial) { const at = cursor++; cells[at] ??= { value: initial }; return [cells[at].value, next => { cells[at].value = typeof next === "function" ? next(cells[at].value) : next; }]; },
    useRef(initial) { const at = cursor++; cells[at] ??= { value: { current: initial } }; return cells[at].value; },
    useEffect(effect, deps) { const at = cursor++; if (!cells[at] || deps.some((dep, i) => dep !== cells[at].deps[i])) { const old = cells[at]; cells[at] = { deps }; effects.push(() => { old?.cleanup?.(); cells[at].cleanup = effect(); }); } },
  };
  const calls = [];
  globalThis.__exportAPI = async (path, options) => {
    if (path === "/metadata-versions/latest") return { data: { published: true, version: 1, document: { schema_version: 2, importable: true, sheets: [{ name: "main", source_sheets: ["Main"], columns: [{ name: "pubchemcid", data_type: "text" }, { name: "lsid_original", data_type: "text" }, { name: "referenceid", reference: true, data_type: "text" }] }] } } };
    const metadata = ["pubchemcid", "names", "lsid_original", "genus_original", "species_original"].map(column => ({ column }));
    if (path === "/metadata") return { data: { metadata } };
    calls.push(options.params);
    const chemical = options.params.q.startsWith("names");
    const name = options.params.q.match(/Compound \d+/)?.[0];
    return { data: { metadata, data: chemical ? [{ pubchemcid: name, names: name }] : [{ lsid_original: "taxon", genus_original: "Genus", species_original: "species" }], truncated: false } };
  };
  t.after(() => { cells.forEach(cell => cell.cleanup?.()); delete globalThis.__exportHooks; delete globalThis.__exportAPI; });
  const render = () => { cursor = 0; tree = PublicationMainExport({ findings, selectedFinding, onSelectFinding() {} }); const pending = effects; effects = []; pending.forEach(fn => fn()); };
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const settle = async () => { for (let i = 0; i < 20; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render(); await settle();
  assert.equal(calls.length, 0);
  assert.equal(nodes(tree).filter(node => node.type === "tr").length, 11);
  selectedFinding = 12; await settle();
  assert.equal(nodes(tree).filter(node => node.type === "tr").length, 4);
  assert.ok(nodes(tree).some(node => node.type === "tr" && node.props["aria-current"] === true));
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Include finding 13"));
  nodes(tree).find(node => node.props["aria-label"] === "Previous export page").props.onClick(); await settle();
  assert.equal(nodes(tree).filter(node => node.type === "tr").length, 11);
  assert.ok(!nodes(tree).some(node => node.props["aria-label"] === "Include finding 13"));
  nodes(tree).find(node => node.props["aria-label"] === "Next export page").props.onClick(); await settle();
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Include finding 13"));
  selectedFinding = 0; await settle();
  assert.ok(nodes(tree).some(node => node.props["aria-label"] === "Include finding 1"));
  assert.ok(nodes(tree).some(node => node.type === "tr" && node.props["aria-current"] === true));
  nodes(tree).find(node => node.type === "button" && node.props.children === "Resolve IDs").props.onClick();
  await settle();
  assert.equal(calls.length, 14);
  assert.equal(calls.filter(call => call.q.startsWith("genus_original")).length, 1);
  assert.ok(calls.every(call => call.columns && call.limit === "100" && !call.q.includes("reference")));
  const text = nodes(tree).find(node => node.type === "textarea").props.value;
  assert.equal(text.split("\r\n").length, 14);
  assert.equal(text.split("\r\n").at(-1), "Compound 12\ttaxon\t");
  let finish, signal;
  globalThis.__exportAPI = async (_path, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  nodes(tree).find(node => node.type === "button" && node.props.children === "Resolve IDs").props.onClick(); render();
  assert.ok(nodes(tree).filter(node => typeof node.type === "function" && node.props.column?.lookup).every(node => node.props.disabled));
  nodes(tree).find(node => node.type === "button" && node.props.children === "Cancel resolution").props.onClick(); render();
  assert.equal(signal.aborted, true);
  finish({ data: { metadata: [{ column: "names" }, { column: "pubchemcid" }], data: [{ pubchemcid: "stale", names: "Compound 0" }] } });
  await settle();
  assert.equal(nodes(tree).find(node => node.type === "textarea").props.value, text);
  assert.ok(nodes(tree).some(node => node.props?.children === "Resolution cancelled; completed values retained."));
});
