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

const metadata = [
  { column: "chemical_id", name: "Chemical ID", type: "table_chemical keycolumn", description: "" },
  { column: "trivial_names", name: "Trivial names", type: "table_chemical", description: "" },
  { column: "classification_id", name: "Species ID", type: "table_specie keycolumn", description: "" },
  { column: "family", name: "Family", type: "clas[7]", description: "" },
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
      color: "#1E3A8A",
      response: { metadata, data },
      fetchedAt: "2026-09-12T00:00:00.000Z",
    },
    {
      query: "familia = 'Apiaceae'",
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

test("compare bar keeps URL primary query when displayed rows come from a visible comparison", () => {
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

  assert.match(html, /<li class="query-compare-bar__item is-hidden">/);
  assert.match(html, new RegExp(`title="${urlPrimary.replaceAll("'", "&#x27;")}"`));
  assert.match(html, new RegExp(`aria-label="Show ${urlPrimary.replaceAll("'", "&#x27;")}"`));
  assert.match(html, new RegExp(`title="${visibleComparison.replaceAll("'", "&#x27;")}"`));
});
