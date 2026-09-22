import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const mapping = await server.ssrLoadModule("/src/TaxonPage/taxonIdMapping.ts");
const editor = await server.ssrLoadModule("/src/Admin/TaxonIdMapping.tsx");

const hookServer = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
  plugins: [{ name: "taxon-mapping-hooks", enforce: "pre", transform(code, id) {
    if (id.endsWith("/Admin/TaxonIdMapping.tsx")) return code.replace('from "react"', 'from "virtual:taxon-mapping-hooks"');
  }, resolveId(id, importer) {
    if (id === "virtual:taxon-mapping-hooks") return "\0taxon-mapping-hooks";
    if (importer?.endsWith("/Admin/TaxonIdMapping.tsx") && id === "./utils") return "\0taxon-mapping-utils";
  }, load(id) {
    if (id === "\0taxon-mapping-hooks") return `export const useState=(...a)=>globalThis.__taxonMappingHooks.useState(...a);export const useCallback=(fn)=>fn;`;
    if (id === "\0taxon-mapping-utils") return `export const api={get:(...a)=>globalThis.__taxonMappingAPI.get(...a),post:(...a)=>globalThis.__taxonMappingAPI.post(...a)};export const getToken=()=>"test-token";`;
  } }],
});
after(() => hookServer.close());
const { default: MappingUpload } = await hookServer.ssrLoadModule("/src/Admin/TaxonIdMapping.tsx");

function text(node) { return node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children); }
function nodes(node) { return node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
async function flush() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }

function mountMapping(api) {
  const cells = []; let cursor = 0; let tree;
  globalThis.__taxonMappingHooks = {
    useState(initial) {
      const at = cursor++;
      cells[at] ??= { value: initial };
      return [cells[at].value, next => { cells[at].value = typeof next === "function" ? next(cells[at].value) : next; }];
    },
  };
  globalThis.__taxonMappingAPI = api;
  const render = () => {
    cursor = 0;
    const root = MappingUpload({});
    const dialog = nodes(root).find(node => typeof node.type === "function");
    tree = dialog ? [root.props.children[0], dialog.type(dialog.props)] : root;
    return tree;
  };
  const find = predicate => nodes(tree).find(predicate);
  const clickOpen = () => find(node => node.type === "button" && text(node) === "Upload taxon-ID mapping").props.onClick();
  const chooseFile = () => find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: { files: [new Blob(["mapping"])] } });
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  return { render, find, clickOpen, chooseFile, submit };
}

test("stored provider IDs take priority per source and only missing numeric providers need ENA resolution", () => {
  const ids = { ncbi: "3702", ena: "", uniprot: " 3702 ", "ensembl-plants": "4577" };
  assert.equal(mapping.storedProviderID("ncbi", ids), "3702");
  assert.equal(mapping.storedProviderID("ena", ids), undefined);
  assert.equal(mapping.storedProviderID("uniprot", ids), "3702");
  assert.equal(mapping.storedProviderID("geo", ids), undefined);
  assert.equal(mapping.needsProviderTaxonomy(["ncbi", "uniprot", "ensembl-plants"], ids), false);
  assert.equal(mapping.needsProviderTaxonomy(["ncbi", "ena", "geo"], ids), true);
  assert.equal(mapping.needsProviderTaxonomy(["geo", "biostudies"], ids), false);
});

test("admin mapping upload uses a modal with the fixed server schema", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = storage;
  globalThis.sessionStorage = storage;
  globalThis.window = { location: { search: "" } };
  try {
  const trigger = renderToStaticMarkup(createElement(editor.default));
  const html = renderToStaticMarkup(createElement(editor.TaxonIdMappingDialog, {
    open: true, busy: false, file: null, current: null, notice: "", statusReady: true,
    onClose() {}, onRefresh() {}, onFileChange() {}, onSubmit() {},
  }));
  assert.match(trigger, /Upload taxon-ID mapping/);
  assert.doesNotMatch(trigger, /role="dialog"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /TaxonIDs/);
  assert.match(html, /name, rank, ncbi_taxid, ena_taxid, uniprot_taxid, ensembl_taxid/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /type="text"/);
  assert.doesNotMatch(html, /name_column/);
  assert.match(html, /does not change workbook metadata/);

  const unavailable = renderToStaticMarkup(createElement(editor.TaxonIdMappingDialog, {
    open: true, busy: false, file: { name: "mapping.csv" }, current: null, notice: "Could not load", statusReady: false,
    onClose() {}, onRefresh() {}, onFileChange() {}, onSubmit() {},
  }));
  assert.match(unavailable, /Retry status/);
  assert.match(unavailable, /<button type="submit" class="btn btn-primary" disabled="">Upload<\/button>/);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.window = originalWindow;
  }
});

test("mapping upload reloads versions, sends no editable config, and safely recovers conflicts", async () => {
  const posts = [];
  let getVersion = 1;
  let conflict = true;
  const mounted = mountMapping({
    get: async () => ({ data: { version: getVersion, row_count: 4, created_at: "2026-09-22" } }),
    post: async (_url, body, options) => {
      posts.push({ keys: [...body.keys()], base: body.get("base_version"), authorization: options.headers.Authorization });
      if (conflict) { conflict = false; getVersion = 2; throw { response: { status: 409 } }; }
      return { data: { version: 3, row_count: 5, created_at: "2026-09-22" } };
    },
  });
  mounted.render();
  mounted.clickOpen();
  await flush();
  mounted.render();
  mounted.chooseFile();
  mounted.render();
  mounted.submit();
  await flush();
  mounted.render();
  assert.deepEqual(posts[0], { keys: ["file", "base_version"], base: "1", authorization: "Bearer test-token" });
  assert.match(text(mounted.render()), /current version is loaded; retry your upload/);
  mounted.submit();
  await flush();
  mounted.render();
  assert.equal(posts[1].base, "2");
  assert.equal(mounted.find(node => node.props?.role === "dialog"), undefined);
});

test("mapping status failures block uploads until status is retried", async () => {
  let calls = 0;
  let posts = 0;
  const mounted = mountMapping({
    get: async () => { calls += 1; if (calls === 1) throw { response: { status: 503 } }; return { data: { version: 4, row_count: 1, created_at: "2026-09-22" } }; },
    post: async () => { posts += 1; return { data: {} }; },
  });
  mounted.render();
  mounted.clickOpen();
  await flush();
  mounted.render();
  mounted.chooseFile();
  mounted.render();
  mounted.submit();
  await flush();
  assert.equal(posts, 0);
  assert.match(text(mounted.render()), /Retry status/);
  mounted.find(node => node.type === "button" && text(node) === "Retry status").props.onClick();
  await flush();
  mounted.render();
  assert.match(text(mounted.render()), /Current mapping: v4/);
});
