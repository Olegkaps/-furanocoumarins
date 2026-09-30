import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const { default: Tree, buildUniquesByClades, countAtPrefix } =
  await server.ssrLoadModule("/src/SearchApp/PhylogeneticTree.tsx");
const { subtractMinusResponses } = await server.ssrLoadModule("/src/SearchApp/compareMinus.ts");
const ranks = ["__root__", "family", "genus", "species"];
const rows = [
  { family: "F", genus: "G", species: "a", smiles: "C", ref: "r" },
  { family: "F", genus: "G", species: "a", smiles: "C", ref: "r" },
  { family: "F", genus: "H", species: "b", smiles: "C", ref: "s" },
  { family: "F", genus: "", species: "c", smiles: "D", ref: "r" },
  { family: "FF", genus: "G", species: "d", smiles: "E", ref: "t" },
  { family: "", genus: "", species: "e", smiles: "", ref: "" },
  { family: "", genus: "G", species: "f" },
];
const build = (data = rows, columns = ranks, smiles = ["smiles"], refs = ["ref"]) =>
  buildUniquesByClades(data, columns, smiles, refs);
const count = (leaves, path, mode = "all") => countAtPrefix(leaves, path, mode, ["smiles"], ["ref"]);

test("prefix counts deduplicate shared descendants and retain records, blanks and root semantics", () => {
  const leaves = build();
  assert.deepEqual(["all", "chemicals", "articles"].map(mode => count(leaves, ["F"], mode)), [4, 2, 2]);
  assert.deepEqual(["all", "chemicals", "articles"].map(mode => count(leaves, [], mode)), [7, 4, 4]);
  assert.equal(count(leaves, ["F", ""]), 1);
  assert.equal(count(leaves, ["", ""]), 1);
  assert.equal(count(leaves, [""]), 7, "legacy empty prefix means the root");
  assert.equal(count(leaves, ["missing"]), 0);
  assert.equal(count(build([]), []), 0);
  assert.equal(countAtPrefix(leaves, [], "chemicals", [], ["ref"]), 0);
  assert.equal(countAtPrefix(leaves, [], "articles", ["smiles"], []), 0);
});

test("indexed totals equal the original scan at every prefix in every count mode", () => {
  const leaves = build([...rows, ...Array.from({ length: 500 }, (_, i) => ({
    family: `F${i % 5}`, genus: i % 3 ? `G${i % 7}` : "", species: `s${i}`,
    smiles: `c${i % 13}`, ref: `r${i % 17}`,
  }))]);
  const paths = [[], ["missing"]];
  for (const key of Object.keys(leaves)) {
    const parts = key.split("@");
    for (let i = 1; i <= parts.length; i++) paths.push(parts.slice(0, i));
  }
  for (const path of paths) {
    const prefix = path.join("@");
    const matching = Object.entries(leaves).filter(([key]) =>
      !prefix || key === prefix || key.startsWith(`${prefix}@`)).map(([, value]) => value);
    for (const mode of ["all", "chemicals", "articles"]) {
      const expected = mode === "all" ? matching.reduce((sum, leaf) => sum + leaf.total, 0)
        : new Set(matching.flatMap(leaf => [...leaf[mode === "chemicals" ? "smiles" : "refs"]])).size;
      assert.equal(count(leaves, path, mode), expected, `${prefix}: ${mode}`);
    }
  }
});

test("immutable snapshots reuse cached leaves and invalidate rows, taxonomy and value columns", () => {
  const first = build();
  build(rows.slice(1));
  assert.equal(build(rows, [...ranks]), first, "restoring plus reuses the original rows");
  assert.notEqual(build([...rows]), first);
  assert.notEqual(build(rows, ["__root__", "species"]), first);
  assert.notEqual(build(rows, ranks, ["other"]), first);
  assert.notEqual(build(rows, ranks, ["smiles"], ["other"]), first);
  assert.equal(count(build(rows, ranks, ["other"]), [], "chemicals"), 0);
  const changed = build([...rows, { family: "new", smiles: "new", ref: "new" }]);
  assert.equal(count(changed, [], "chemicals"), 5);
  assert.equal(count(first, [], "chemicals"), 4);
});

test("warm prefix lookups do not revisit leaf values", () => {
  const leaf = { total: 2, smiles: new Set(["C"]), refs: new Set(["r"]) };
  let reads = 0;
  const leaves = { get "F@G@s"() { reads++; return leaf; } };
  assert.equal(count(leaves, []), 2);
  const initialReads = reads;
  for (let i = 0; i < 100; i++) {
    assert.equal(count(leaves, ["F"], "chemicals"), 1);
    assert.equal(count(leaves, ["F", "G"], "articles"), 1);
  }
  assert.equal(reads, initialReads);
});

const metadata = [
  ...ranks.slice(1).map((column, index) => ({ column, name: column, type: `clas[${2 - index}]` })),
  { column: "smiles", name: "smiles", type: "SMILES" },
  { column: "ref", name: "ref", type: "ref[]" },
];
const render = (series, params = "count=chemicals&to=0") => renderToStaticMarkup(createElement(
  MemoryRouter, { initialEntries: [`/tree?query=x&${params}`] }, createElement(Tree, {
    response: series[0].response, compareSeries: series,
  }),
));

test("rendered comparison preserves per-series colors and unique counts across rank collapse", () => {
  const series = [
    { color: "#123456", query: "x", response: { metadata, data: rows.slice(0, 5) } },
    { color: "#abcdef", query: "y", response: { metadata, data: rows.slice(0, 3) } },
  ];
  const html = render(series);
  assert.match(html, /color:#123456[^>]*title="2 chemicals">2</);
  assert.match(html, /color:#abcdef[^>]*title="1 chemicals">1</);
  assert.match(html, /title="family">F</);
  assert.doesNotMatch(html, /title="species">a</);
  const expanded = render(series, "count=chemicals&from=1&to=2");
  assert.match(expanded, /tree-branch-label is-collapsed/);
  assert.match(expanded, /title="2 chemicals">2</);
  assert.match(render(series, "count=all&to=0"), /title="4 records">4</);
  const recolored = [{ ...series[0], color: "#fedcba" }, series[1]];
  assert.match(render(recolored), /color:#fedcba/);
  assert.doesNotMatch(render(recolored), /color:#123456/);
});

test("configured chemical count key uses whole nonblank values instead of SMILES", () => {
  const configuredMetadata = [
    { column: "family", name: "family", type: "clas[1]" },
    { column: "species", name: "species", type: "clas[0]" },
    { column: "smiles", name: "smiles", type: "SMILES" },
    { column: "chemical_family", name: "Chemical family", type: "invisible", entity_count_key: "chemical" },
  ];
  const configuredRows = [
    { family: "F", species: "one", smiles: "C", chemical_family: "A,B" },
    { family: "F", species: "two", smiles: "CC", chemical_family: "A,B" },
    { family: "F", species: "three", smiles: "CCC", chemical_family: " " },
    { family: "F", species: "four", smiles: "CCCC", chemical_family: "No Value" },
  ];
  const html = renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: ["/tree?query=x&count=chemicals&to=0"] },
    createElement(Tree, { response: { metadata: configuredMetadata, data: configuredRows } }),
  ));

  assert.match(html, /title="1 chemicals">1</);
  assert.doesNotMatch(html, /title="4 chemicals">4</);
});

test("Planar and All switch chemical identities independently of articles and observations, including cached comparisons and minus rows", () => {
  const identityMetadata = [
    { column: "family", name: "Family", type: "clas[1]" },
    { column: "species", name: "Species", type: "table_specie keycolumn clas[0]" },
    { column: "chemical_id", name: "Chemical ID", type: "invisible external[structures] keycolumn" },
    { column: "planar_id", name: "Planar ID", type: "invisible", entity_count_key: "chemical" },
    { column: "smiles", name: "SMILES", type: "SMILES" },
    { column: "ref", name: "Reference", type: "ref[]" },
  ];
  const identityRows = [
    { family: "F", species: "one", chemical_id: "c1", planar_id: "A", smiles: "C", ref: "r1" },
    { family: "F", species: "two", chemical_id: "c2", planar_id: "A", smiles: "C", ref: "r2" },
    { family: "F", species: "three", chemical_id: "c3", planar_id: " ", smiles: "C", ref: "r3" },
    { family: "F", species: "four", chemical_id: "c4", planar_id: "NO VALUE", smiles: "C", ref: "r4" },
    { family: "F", species: "five", chemical_id: "c5", planar_id: "a", smiles: "C", ref: "r5" },
  ];
  identityRows.push(identityRows[0]);
  const response = { metadata: identityMetadata, data: identityRows };
  const series = [
    { query: "first", color: "#123456", response },
    { query: "second", color: "#abcdef", response: { metadata: identityMetadata, data: identityRows.slice(0, 2) } },
  ];
  const planar = render(series);
  assert.match(planar, /color:#123456[^>]*title="2 chemicals">2</);
  assert.match(planar, /color:#abcdef[^>]*title="1 chemicals">1</);
  assert.match(planar, /aria-pressed="true">Planar<\/button>/);
  assert.match(planar, /Chemical identity: planar_id/);
  const all = render(series, "count=chemicals&chemical_identity=all&to=0");
  assert.match(all, /color:#123456[^>]*title="5 chemicals">5</);
  assert.match(all, /color:#abcdef[^>]*title="2 chemicals">2</);
  assert.match(all, /aria-pressed="true">All<\/button>/);
  assert.match(all, /Chemical identity: chemical_id/);
  assert.equal(render(series), planar, "switching back reuses the correct immutable snapshot");
  for (const identity of ["planar", "all"]) {
    assert.match(render(series, `count=articles&chemical_identity=${identity}&to=0`), /color:#123456[^>]*title="5 articles">5</);
    assert.match(render(series, `count=all&chemical_identity=${identity}&to=0`), /color:#123456[^>]*title="6 records">6</);
  }
  const remaining = subtractMinusResponses(response, [{ metadata: identityMetadata, data: [identityRows[0]] }]);
  const remainingSeries = [{ ...series[0], response: remaining }];
  assert.match(render(remainingSeries), /title="2 chemicals">2</);
  assert.match(render(remainingSeries, "count=chemicals&chemical_identity=all&to=0"), /title="4 chemicals">4</);
  assert.equal(response.data.length, 6, "minus leaves original observations intact");
});

test("chemical primary key is the default when no custom count column exists, while legacy responses retain SMILES counting", () => {
  const response = { metadata: [
    ...metadata,
    { column: "chemical_id", name: "Chemical ID", type: "table_chemical keycolumn" },
  ], data: [
    { family: "F", genus: "G", species: "one", smiles: "C", chemical_id: "c1" },
    { family: "F", genus: "G", species: "two", smiles: "C", chemical_id: "c2" },
    { family: "F", genus: "G", species: "three", smiles: "C", chemical_id: "" },
  ] };
  assert.match(render([{ response }]), /title="2 chemicals">2</);
  assert.match(render([{ response }], "count=chemicals&chemical_identity=all&to=0"), /title="2 chemicals">2</);
  assert.match(render([{ response: { metadata, data: response.data } }]), /title="1 chemicals">1</);
});
