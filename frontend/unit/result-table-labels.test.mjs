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
const { default: ResultTable } = await server.ssrLoadModule("/src/SearchApp/ResultTable.tsx");
const { RankedSelectList, entityValues, rowsFromResponseData } = await server.ssrLoadModule("/src/SearchApp/ResultTable.tsx");
const { SearchLink } = await server.ssrLoadModule("/src/SearchApp/SearchLine.tsx");
const { filterResponse } = await server.ssrLoadModule("/src/SearchApp/searchApi.tsx");

test("grouped rows reuse immutable plus snapshots and invalidate changed data, metadata and keys", () => {
  const meta = [
    { name: "species", is_specie: true },
    { name: "chemical", is_chemical: true },
    { name: "article" },
  ];
  const data = [{ species: "a", chemical: "b", article: "c" }];
  const first = rowsFromResponseData(data, meta, "chemical", "species");
  rowsFromResponseData([], meta, "chemical", "species");
  assert.equal(rowsFromResponseData(data, meta, "chemical", "species"), first);
  assert.equal(first[0].specie_val, "a");
  assert.equal(first[0].chemical_val, "b");
  assert.notEqual(rowsFromResponseData([...data], meta, "chemical", "species"), first);
  assert.notEqual(rowsFromResponseData(data, [...meta], "chemical", "species"), first);
  const changedKeys = rowsFromResponseData(data, meta, "missing", "species");
  assert.equal(changedKeys[0].chemical_val, "");
  assert.notEqual(changedKeys, first);
  assert.equal(rowsFromResponseData([], meta, "chemical", "species").length, 0);
});

test("entity membership scans union keys without inspecting labels or article rows", () => {
  const row = (specie_val, chemical_val) => ({ specie_val, chemical_val,
    get value_rows() { throw new Error("counting entities must not aggregate articles"); } });
  const series = [{ rows: [] }, { rows: [row("a", "x"), row("b", "y"), row("a", "x")] }];
  assert.deepEqual([...entityValues(series, "specie")], ["a", "b"]);
  assert.deepEqual([...entityValues(series, "specie", "x")], ["a"]);
  assert.deepEqual([...entityValues(series, "chemical", "b")], ["y"]);
  assert.equal(entityValues(series, "chemical", "missing").size, 0);
});

test("ranked lists bound initial markup and expose pagination only above the boundary", () => {
  for (const size of [0, 1, 100, 101, 10000]) {
    const options = Array.from({ length: size }, (_, i) => ({ value: String(i), label: `Entity ${i}`, count: i }));
    const html = renderToStaticMarkup(createElement(RankedSelectList, { options, countModeLabel: "Count", onSelect() {} }));
    assert.equal((html.match(/class="ranked-select-list__item"/g) ?? []).length, Math.min(size, 100));
    assert.equal(html.includes('aria-label="Next page"'), size > 100);
    if (size > 100) {
      assert.match(html, /aria-label="Previous page" disabled=""/);
      assert.doesNotMatch(html, /aria-label="Next page" disabled=""/);
      assert.match(html, new RegExp(`1-100 of ${size}`));
    }
  }
});

test("disabled tree link has no navigation target while enabled link preserves query parameters", () => {
  const render = disabled => renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ["/table?query=a&tag=accepted&cmp_minus=b"],
  }, createElement(SearchLink, { path: "/tree", text: "Phylogenetic Tree", disabled })));
  assert.match(render(true), /role="link" aria-disabled="true"/);
  assert.doesNotMatch(render(true), /href=/);
  assert.match(render(false), /href="\/tree\?query=a&amp;tag=accepted&amp;cmp_minus=b"/);
});

const metadata = [
  { column: "chemical_id", name: "Chemical ID", type: "table_chemical keycolumn", description: "" },
  { column: "trivial_names", name: "Trivial names", type: "table_chemical", description: "" },
  { column: "classification_id", name: "Species ID", type: "table_specie keycolumn", description: "" },
  { column: "family", name: "Family", type: "table_specie clas[7]", description: "" },
  { column: "genus", name: "Genus", type: "table_specie clas[1]", description: "" },
  { column: "species", name: "Species", type: "table_specie clas[0]", description: "" },
  { column: "referenceid", name: "Reference", type: "table_0 ref[]", description: "" },
];

const data = [
  {
    chemical_id: "chem-1",
    trivial_names: "Neobyakangelicol=5-O-Methyl isogosferol",
    classification_id: "sp-1",
    family: "Apiaceae",
    genus: "Angelica",
    species: "dahurica",
    referenceid: "paper-1",
  },
  {
    chemical_id: "chem-2",
    trivial_names: "Bergapten=5-methoxypsoralen",
    classification_id: "sp-2",
    family: "Rutaceae",
    genus: "Ruta",
    species: "graveolens",
    referenceid: "paper-2",
  },
];

test("empty primary still displays later plus entities with their original keys", () => {
  const series = [
    { query: "empty", mode: "plus", color: "red", response: { metadata, data: [] } },
    { query: "populated", mode: "plus", color: "green", response: { metadata, data } },
  ];
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata, data: [], compareSeries: series,
  })));
  assert.match(html, />Angelica dahurica</);
  assert.match(html, />Ruta graveolens</);
  assert.match(html, /Species \(2\)/);
  assert.match(html, /Chemical \(2\)/);
});

test("results side lists display configured names instead of entity ids", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, { metadata, data })));

  assert.match(html, />Neobyakangelicol</);
  assert.match(html, />Bergapten</);
  assert.match(html, />Angelica dahurica</);
  assert.match(html, />Ruta graveolens</);
  assert.doesNotMatch(html, />chem-1</);
  assert.doesNotMatch(html, />sp-1</);
  assert.doesNotMatch(html, />Apiaceae Angelica</);
  assert.doesNotMatch(html, /5-O-Methyl isogosferol</);
});

test("a selected species links to its rank-zero taxon page", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata,
    data: [data[0]],
  })));

  assert.match(html, /href="\/taxon\/0\?name=dahurica"/);
  assert.match(html, />Open species page</);
  assert.match(html, /Family/);
  assert.match(html, /Genus/);
  assert.match(html, /Species/);
  assert.match(html, />Apiaceae</);
  assert.match(html, />Angelica</);
  assert.match(html, />dahurica</);
});

test("unselected classification does not enter result detail panels", () => {
  const unselected = metadata.map((item) =>
    item.column === "family" ? { ...item, type: "clas[7]" } : item,
  );
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: unselected,
    data: [data[0]],
  })));

  assert.doesNotMatch(html, />Family</);
  assert.doesNotMatch(html, />Apiaceae</);
});

test("result-table classifications replace NoValue variants with their original rank", () => {
  const metadata = [
    { column: "family_original", name: "Family", type: "table_specie clas[4]", description: "" },
    { column: "family_powo", name: "POWO family", type: "table_specie clas[4][powo]", description: "" },
  ];
  const filtered = filterResponse({ metadata, data: [{ family_original: "Apiaceae", family_powo: "NoValue" }] });
  assert.equal(filtered.data[0].family_powo, "Apiaceae");
});

test("results side lists honor an explicit chemical list name column", () => {
  const explicitMetadata = metadata.map((item) =>
    item.column === "trivial_names"
      ? { ...item, column: "display_name", name: "Display name", type: "table_chemical list_name" }
      : item,
  );
  const explicitData = data.map(({ trivial_names, ...item }) => ({
    ...item,
    display_name: `${trivial_names.split("=")[0]} label=ignored synonym`,
    trivial_names: `Wrong ${trivial_names}`,
  }));
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, { metadata: explicitMetadata, data: explicitData })));

  assert.match(html, />Neobyakangelicol label</);
  assert.match(html, />Bergapten label</);
  assert.doesNotMatch(html, />Wrong Neobyakangelicol</);
});

test("chemical list_name marker can use any chemical column", () => {
  const markedMetadata = metadata.map((m) =>
    m.column === "trivial_names"
      ? { ...m, column: "display_name", type: "table_chemical list_name" }
      : m,
  );
  const markedData = data.map(({ trivial_names, ...row }) => ({
    ...row,
    display_name: trivial_names.replace("=", " = synonym "),
  }));

  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: markedMetadata,
    data: markedData,
  })));

  assert.match(html, />Neobyakangelicol</);
  assert.match(html, />Bergapten</);
  assert.doesNotMatch(html, />chem-1</);
  assert.doesNotMatch(html, /synonym/);
});

test("compare series side lists include labels from every query", () => {
  const extraData = [
    {
      chemical_id: "chem-extra",
      trivial_names: "Imperatorin=ignored synonym",
      classification_id: "sp-extra",
      family: "Apiaceae",
      genus: "Levisticum",
      species: "officinale",
      referenceid: "paper-extra",
    },
  ];
  const compareSeries = [
    {
      query: "type_structure CONTAINS 'ang'",
      mode: "plus",
      color: "#1E3A8A",
      response: { metadata, data },
      fetchedAt: "2026-09-12T00:00:00.000Z",
    },
    {
      query: "familia = 'Apiaceae'",
      mode: "plus",
      color: "#B45309",
      response: { metadata, data: extraData },
      fetchedAt: "2026-09-12T00:01:00.000Z",
    },
  ];

  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata,
    data,
    compareSeries,
  })));

  assert.match(html, />Imperatorin</);
  assert.match(html, />Levisticum officinale</);
  assert.doesNotMatch(html, />chem-extra</);
  assert.doesNotMatch(html, />sp-extra</);
});

test("compare bar is collapsed by default when rows come from a visible comparison", () => {
  const urlPrimary = "type_structure CONTAINS 'ang'";
  const visibleComparison = "type_structure CONTAINS 'lin'";
  const params = new URLSearchParams();
  params.set("query", urlPrimary);
  params.set("cmp", JSON.stringify([visibleComparison]));
  params.set("cmp_hidden", JSON.stringify([urlPrimary]));

  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/table?${params.toString()}`] },
      createElement(ResultTable, {
        metadata,
        data,
        colorsByQuery: {
          [urlPrimary]: "#1E3A8A",
          [visibleComparison]: "#B45309",
        },
        primaryQuery: visibleComparison,
        compareBarPrimaryQuery: urlPrimary,
      }),
    ),
  );

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />Compare queries</);
  assert.match(html, />2 plus</);
  assert.doesNotMatch(html, /query-compare-bar__list/);
});

test("empty result table still renders compare controls", () => {
  const params = new URLSearchParams();
  params.set("query", "plus query");
  params.set("cmp", JSON.stringify(["minus query"]));
  params.set("cmp_minus", JSON.stringify(["minus query"]));

  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/table?${params.toString()}`] },
      createElement(ResultTable, {
        metadata,
        data: [],
        colorsByQuery: {
          "plus query": "#1E3A8A",
          "minus query": "#B45309",
        },
        primaryQuery: "plus query",
        compareBarPrimaryQuery: "plus query",
      }),
    ),
  );

  assert.match(html, />Compare queries</);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />1 plus, 1 minus</);
  assert.doesNotMatch(html, />No data for given request</);
});
