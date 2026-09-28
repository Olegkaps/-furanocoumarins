import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const catalog = await server.ssrLoadModule("/src/Catalog/CatalogPage.tsx");
const model = await import("../src/Catalog/catalogModel.mjs");

const columns = [
  { column: "genus_original", name: "Genus", type: "text clas[1] tag[original]", description: "" },
  { column: "species_original", name: "Species", type: "text clas[0] tag[original]", description: "" },
  { column: "species_powo", name: "Species POWO", type: "text clas[0] tag[powo]", description: "" },
];

test("species catalog titles use the original genus plus species", () => {
  assert.equal(model.classificationColumn(columns, 0), "species_original");
  assert.equal(model.recordTitle("species", columns, { genus_original: "Angelica", species_original: "archangelica", species_powo: "officinalis" }), "Angelica archangelica");
});

test("chemical titles prefer the declared name over source IDs and retain ID fallbacks", () => {
  const chemicalColumns = [
    { column: "cid", name: "CID", type: "text primary", description: "" },
    { column: "names", name: "Name", type: "text", description: "" },
  ];
  assert.equal(model.recordTitle("chemicals", chemicalColumns, { cid: "6789", names: " Xanthotoxin " }), "Xanthotoxin");
  assert.equal(model.recordTitle("chemicals", chemicalColumns, { cid: "6789", names: " " }), "6789");
  assert.equal(model.recordTitle("chemicals", chemicalColumns, { cid: "6789", names: ["Xanthotoxin", "Methoxsalen"] }), "Xanthotoxin");
  assert.equal(model.recordTitle("chemicals", chemicalColumns, { cid: "6789", names: " Xanthotoxin = Methoxsalen " }), "Xanthotoxin");
  assert.equal(model.recordTitle("chemicals", chemicalColumns, { cid: "6789", names: " = Methoxsalen " }), "6789");
});

test("chemical titles preserve recognized physical names and trivial-name labels", () => {
  const primary = { column: "cid", name: "CID", type: "text primary", description: "" };
  for (const column of [
    { column: "chemical_names", name: "Chemical names" },
    { column: "trivial_name", name: "Name" },
    { column: "trivial_names", name: "Trivial names" },
    { column: "preferred_label", name: "Trivial name" },
  ]) {
    const fields = [primary, { ...column, type: "text", description: "" }];
    assert.equal(model.recordTitle("chemicals", fields, { cid: "6789", [column.column]: " Xanthotoxin = Methoxsalen " }), "Xanthotoxin");
  }
  const fields = [primary,
    { column: "title", name: "Title", type: "text", description: "" },
    { column: "trivial_names", name: "Trivial names", type: "text", description: "" },
  ];
  assert.equal(model.recordTitle("chemicals", fields, { cid: "6789", title: "Earlier title", trivial_names: "Xanthotoxin" }), "Xanthotoxin");
});

test("catalog page position is truthful for cursor navigation within a session", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };

  assert.equal(model.catalogPageNumber("chemicals", "", "", storage), 1);
  assert.equal(model.catalogPageNumber("chemicals", "direct-link", "", storage), null);

  model.rememberCatalogPageNumber("chemicals", "cursor", "next-cursor", 2, storage);
  model.rememberCatalogPageNumber("chemicals", "before", "previous-cursor", 1, storage);

  assert.equal(model.catalogPageNumber("chemicals", "next-cursor", "", storage), 2);
  assert.equal(model.catalogPageNumber("chemicals", "", "previous-cursor", storage), 1);
  assert.equal(model.catalogPageNumber("species", "next-cursor", "", storage), null);
});

test("catalog count requests are shared across Strict Mode effect restarts", async () => {
  const requests = new Map();
  let calls = 0;
  const load = async () => ({ total: ++calls });
  const first = model.cachedCatalogCountRequest(requests, "chemicals", load);
  const second = model.cachedCatalogCountRequest(requests, "chemicals", load);
  assert.strictEqual(second, first);
  assert.deepEqual(await first, { total: 1 });
  assert.equal(calls, 1);
});

test("catalog page exposes only chemical and species source collections", () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { location: { search: "" } };
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/catalog?kind=species&cursor=Angelica"] }, createElement(catalog.default)));
  assert.match(html, /Data catalog/);
  assert.match(html, /Chemicals/);
  assert.match(html, /Species/);
  assert.doesNotMatch(html, /Publications|kind=publications/);
  assert.match(html, /including chemicals and species that are not joined/);
  assert.doesNotMatch(html, /page=1/);
});

test("direct publication catalog links are unavailable rather than opening a source catalog", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/catalog?kind=publications&cursor=old"] }, createElement(catalog.default)));
  assert.match(html, /Catalog unavailable/);
  assert.match(html, /Browse chemicals and species/);
  assert.doesNotMatch(html, /Loading|catalog-tabs|catalog-grid|kind=publications/);
});

test("catalog entity cards use stable ID routes", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/Catalog/CatalogPage.tsx", import.meta.url)), "utf8");
  assert.match(source, /chemicalPagePath\(id\)/);
  assert.match(source, /speciesPagePath\(id\)/);
  assert.doesNotMatch(source, /substancePagePath\(smiles\)/);
});

test("full-value controls are outside metadata anchors", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/SearchApp/DataMeta.tsx", import.meta.url)), "utf8");
  const anchor = source.slice(source.indexOf("<a\n                    className=\"meta-link\""), source.indexOf("</a>"));
  assert.doesNotMatch(anchor, /TruncatedText/);
  assert.match(source, /controlOnly/);
});

test("catalog totals use a separate request that is independent of cursor navigation", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/Catalog/CatalogPage.tsx", import.meta.url)), "utf8");
  assert.match(source, /\/catalog\/\$\{kind\}\/count/);
  assert.match(source, /\}, \[kind\]\);/);
  assert.match(source, /page_count/);
  assert.match(source, /Page \$\{currentPage\}/);
});
