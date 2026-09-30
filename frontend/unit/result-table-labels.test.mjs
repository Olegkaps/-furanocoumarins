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
    initialEntries: ["/table?query=a&tag=accepted&cmp_minus=b&chemical_identity=all"],
  }, createElement(SearchLink, { path: "/tree", text: "Phylogenetic Tree", disabled })));
  assert.match(render(true), /role="link" aria-disabled="true"/);
  assert.doesNotMatch(render(true), /href=/);
  assert.match(render(false), /href="\/tree\?query=a&amp;tag=accepted&amp;cmp_minus=b&amp;chemical_identity=all"/);
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
  assert.match(html, /Planar \(2\)/);
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

test("configured count keys group entity lists while retaining blank-key observations", () => {
  const countMetadata = [
    { column: "chemical_id", name: "Chemical ID", type: "table_chemical keycolumn", description: "" },
    { column: "chemical_name", name: "Chemical", type: "table_chemical list_name", description: "" },
    { column: "species_id", name: "Species ID", type: "table_specie keycolumn", description: "" },
    { column: "species", name: "Species", type: "table_specie clas[0]", description: "" },
    { column: "accepted_name", name: "Accepted name", type: "invisible", description: "", entity_count_key: "species" },
    { column: "chemical_family", name: "Chemical family", type: "invisible", description: "", entity_count_key: "chemical" },
    { column: "referenceid", name: "Reference", type: "table_0 ref[]", description: "" },
  ];
  const countData = [
    { chemical_id: "c1", chemical_name: "One", chemical_family: "A,B", species_id: "s1", species: "one", accepted_name: "A,B", referenceid: "r1" },
    { chemical_id: "c1", chemical_name: "One", chemical_family: "A,B", species_id: "s2", species: "two", accepted_name: "A,B", referenceid: "r2" },
    { chemical_id: "c2", chemical_name: "Two", chemical_family: "A,B", species_id: "s3", species: "three", accepted_name: "No  Value", referenceid: "r3" },
    { chemical_id: "c3", chemical_name: "Three", chemical_family: "", species_id: "s3", species: "three", accepted_name: "No  Value", referenceid: "r4" },
  ];
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: countMetadata, data: countData,
  })));

  assert.match(html, /ranked-select-list__value">A,B<\/span>/, "unresolved group uses its stable count value");
  assert.doesNotMatch(html, /ranked-select-list__value">Three<\/span>/, "blank count key is not selectable");
  assert.equal((html.match(/Species \(1\)/g) ?? []).length, 2);
  assert.equal((html.match(/Planar \(1\)/g) ?? []).length, 2);
  assert.match(html, /Rows in selection:\s*<b>4<\/b>/, "observation rows remain unchanged");
  assert.match(html, /Reference \(4\)/, "article counting remains unchanged");
  assert.match(html, /Planar identity: chemical_family \(Chemical family\); species identity: accepted_name \(Accepted name\)/);
  assert.match(html, /Articles count distinct references from referenceid \(Reference\)\. All counts observation rows/);
  assert.doesNotMatch(html, /Missing values|missing values/);

  const selected = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [{ pathname: "/table", state: { resultTable: { currentChemical: "c3", currentSpecie: "", chemicalIdentityMode: "all" } } }],
  }, createElement(ResultTable, { metadata: countMetadata, data: countData })));
  assert.match(selected, /Chemical \(1\)/, "All identities use the original chemical key even without a planar value");
  assert.match(selected, /Species \(0\)/);
  assert.match(selected, /Rows in selection:\s*<b>1<\/b>/);

  const primaryCompareData = [countData[0], countData[3]];
  const secondaryCompareData = [{ ...countData[1], chemical_id: "c2", chemical_name: "Two" }];
  const compared = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: countMetadata,
    data: primaryCompareData,
    compareSeries: [
      { query: "first", mode: "plus", color: "red", response: { metadata: countMetadata, data: primaryCompareData } },
      { query: "second", mode: "plus", color: "blue", response: { metadata: countMetadata, data: secondaryCompareData } },
    ],
  })));
  assert.match(compared, /Planar \(1\)/, "compare union counts the shared configured value once");
  assert.match(compared, />A,B</, "the shared group remains selectable");
});

test("count-key selection uses the unjoined representative and unions member publications across comparisons", () => {
  const groupedMetadata = [
    { column: "chemical_id", name: "Source ID", type: "table_chemical keycolumn", description: "" },
    { column: "names", name: "Names", type: "table_chemical list_name", description: "" },
    { column: "smiles", name: "SMILES", type: "table_chemical SMILES", description: "" },
    { column: "planar_pubchemcid", name: "Planar CID", type: "invisible", entity_count_key: "chemical", description: "" },
    { column: "species_id", name: "Species ID", type: "table_specie keycolumn", description: "" },
    { column: "referenceid", name: "Reference", type: "table_0 ref[]", description: "" },
  ];
  const first = { chemical_id: "442104", names: "Isomer minus", smiles: "C@O", planar_pubchemcid: "150888", species_id: "s1", referenceid: "p1" };
  const second = { chemical_id: "92201", names: "Isomer plus", smiles: "C@@O", planar_pubchemcid: "150888", species_id: "s2", referenceid: "p2" };
  const representative = { primary_column: "chemical_id", count_column: "planar_pubchemcid", columns: groupedMetadata, items: [{ chemical_id: "150888", names: "Columbianetin=alias", smiles: "CO", planar_pubchemcid: "150888" }] };
  const entity_groups = { chemical: representative };
  const render = (state, compareSeries) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [{ pathname: "/table", state: { resultTable: state } }] }, createElement(ResultTable, {
    metadata: groupedMetadata, data: [first], entity_groups, compareSeries,
  })));
  const series = [
    { query: "first", mode: "plus", color: "red", response: { metadata: groupedMetadata, data: [first], entity_groups } },
    { query: "second", mode: "plus", color: "blue", response: { metadata: groupedMetadata, data: [second], entity_groups } },
  ];
  const unselected = render({ currentChemical: "", currentSpecie: "" }, series);
  assert.equal((unselected.match(/ranked-select-list__value">Columbianetin<\/span>/g) ?? []).length, 1);
  assert.match(unselected, /Planar \(1\)/);
  assert.match(unselected, /aria-label="Chemical identity"/);
  assert.match(unselected, /aria-pressed="true">Planar<\/button>/);
  const all = render({ currentChemical: "", currentSpecie: "", chemicalIdentityMode: "all" }, series);
  assert.match(all, /Chemical \(2\)/, "All counts both original chemical source identities");
  assert.match(all, /ranked-select-list__value">Isomer minus<\/span>/);
  assert.match(all, /ranked-select-list__value">Isomer plus<\/span>/);
  assert.doesNotMatch(all, /ranked-select-list__value">Columbianetin<\/span>/);
  assert.match(all, /Chemical identity: chemical_id \(Source ID\)/);
  assert.match(all, /aria-pressed="true">All<\/button>/);
  const urlAll = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [{ pathname: "/table", search: "?chemical_identity=all", state: { resultTable: { chemicalIdentityMode: "planar", currentChemical: "", currentSpecie: "" } } }],
  }, createElement(ResultTable, { metadata: groupedMetadata, data: [first, second], entity_groups })));
  assert.match(urlAll, /Chemical \(2\)/, "tree-to-table identity choice takes precedence over table history");
  assert.match(urlAll, /aria-pressed="true">All<\/button>/);
  const sharedSpecies = mode => renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [{ pathname: "/table", state: { resultTable: { currentChemical: "", currentSpecie: "", chemicalIdentityMode: mode } } }],
  }, createElement(ResultTable, { metadata: groupedMetadata, data: [first, { ...second, species_id: "s1" }], entity_groups })));
  assert.match(sharedSpecies("planar"), /aria-label="planar: 1"/, "species list counts one planar counterpart");
  assert.match(sharedSpecies("all"), /aria-label="chemicals: 2"/, "species list counts both original counterparts in All");
  const member = render({ currentChemical: "442104", currentSpecie: "", chemicalIdentityMode: "all" }, series);
  assert.match(member, /href="\/chemical\/442104"/);
  assert.match(member, /data-smiles="C@O"/);
  assert.match(member, /Reference \(1\)/);
  assert.match(member, /Rows in selection:\s*<b>1<\/b>/);
  assert.doesNotMatch(member, /data-row-chemical="92201"/);
  const selected = render({ currentChemical: "count:150888", currentSpecie: "" }, series);
  assert.match(selected, /href="\/chemical\/150888"/);
  assert.match(selected, /data-smiles="CO"/);
  assert.doesNotMatch(selected, /data-smiles="C@O"|data-smiles="C@@O"/);
  assert.match(selected, /Reference \(2\)/);
  assert.match(selected, /Rows in selection:\s*<b>2<\/b>/);
  assert.match(selected, /data-row-chemical="442104"/);
  assert.match(selected, /data-row-chemical="92201"/);
  const unresolved = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [{ pathname: "/table", state: { resultTable: { currentChemical: "count:150888", currentSpecie: "" } } }],
  }, createElement(ResultTable, { metadata: groupedMetadata, data: [first, second] })));
  assert.match(unresolved, /Planar \(1\)/);
  assert.match(unresolved, /Rows in selection:\s*<b>2<\/b>/);
  assert.match(unresolved, /Reference \(2\)/);
  assert.doesNotMatch(unresolved, /data-smiles="C@O"|data-smiles="C@@O"|href="\/chemical\/150888"/);
});

test("filtered search copies cached rows and retains count metadata and representative enrichment", () => {
  const metadata = [
    { column: "chemical_id", type: "chemical keycolumn invisible" },
    { column: "planar_cid", type: "invisible", entity_count_key: "chemical" },
    { column: "species", type: "specie clas[0]" },
    { column: "species_powo", type: "specie clas[0][powo]" },
  ];
  const row = Object.freeze({ chemical_id: "one", planar_cid: "two", species: "original", species_powo: "NoValue" });
  const payload = { metadata, data: [row], timestamp: "now", entity_groups: { chemical: { items: [] } } };
  const filtered = filterResponse(payload);
  assert.equal(filtered.timestamp, "now");
  assert.equal(filtered.entity_groups, payload.entity_groups);
  assert.equal(filtered.metadata.length, 4);
  assert.equal(filtered.data[0].species_powo, "original");
  assert.equal(row.species_powo, "NoValue");
});

test("case variants of missing count sentinels keep unrelated source records separate", () => {
  const columns = [
    { column: "chemical_id", name: "ID", type: "table_chemical keycolumn", description: "" },
    { column: "names", name: "Name", type: "table_chemical list_name", description: "" },
    { column: "planar", name: "Planar", type: "invisible", entity_count_key: "chemical", description: "" },
    { column: "species_id", name: "Species", type: "table_specie keycolumn", description: "" },
    { column: "referenceid", name: "Reference", type: "table_0 ref[]", description: "" },
  ];
  const data = [
    { chemical_id: "a", names: "Alpha", planar: "novalue", species_id: "s", referenceid: "p1" },
    { chemical_id: "b", names: "Beta", planar: "NO VALUE", species_id: "s", referenceid: "p2" },
  ];
  const render = selected => renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [{ pathname: "/table", state: { resultTable: { currentChemical: selected, currentSpecie: "" } } }],
  }, createElement(ResultTable, { metadata: columns, data })));
  const listed = render("");
  assert.doesNotMatch(listed, />Alpha</);
  assert.doesNotMatch(listed, />Beta</);
  assert.match(listed, /Planar \(0\)/);
  assert.match(listed, /Rows in selection:\s*<b>2<\/b>/);
  assert.match(listed, /Reference \(2\)/);
});

test("same-schema compare snapshots from different datasets are rejected before rendering groups", () => {
  const first = { metadata, data: [data[0]], timestamp: "dataset-a" };
  const second = { metadata, data: [data[1]], timestamp: "dataset-b" };
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    ...first, compareSeries: [
      { query: "a", mode: "plus", color: "red", response: first },
      { query: "b", mode: "plus", color: "blue", response: second },
    ],
  })));
  assert.match(html, /role="alert"/);
  assert.match(html, /different dataset versions/);
  assert.doesNotMatch(html, /Neobyakangelicol|Bergapten|Rows in selection/);
});

test("a selected species with a source keycolumn links to its canonical ID page", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata,
    data: [data[0]],
  })));

  assert.match(html, /href="\/species\/sp-1"/);
  assert.match(html, />Open species page</);
  assert.match(html, /Family/);
  assert.match(html, /Genus/);
  assert.match(html, /Species/);
  assert.match(html, />Apiaceae</);
  assert.match(html, />Angelica</);
  assert.match(html, />dahurica</);
});

test("display identities stay on legacy URLs while source keycolumns use canonical entity URLs", () => {
  const chemicalMetadata = [
    { column: "smiles", name: "SMILES", type: "table_chemical SMILES chemical", description: "" },
    { column: "source_id", name: "Source ID", type: "keycolumn invisible external[structures]", description: "" },
  ];
  const chemicalHTML = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: chemicalMetadata,
    data: [{ smiles: "C/C", source_id: "chemical-42" }],
  })));
  assert.match(chemicalHTML, /href="\/chemical\/chemical-42"/);
  assert.doesNotMatch(chemicalHTML, /href="\/chemical\/C%2FC"/);

  const speciesMetadata = [
    { column: "species", name: "Species", type: "table_specie keycolumn primary clas[0] specie", description: "" },
    { column: "source_id", name: "Source ID", type: "keycolumn invisible external[classification]", description: "" },
  ];
  const speciesHTML = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultTable, {
    metadata: speciesMetadata,
    data: [{ species: "communis", source_id: "species-42" }],
  })));
  assert.match(speciesHTML, /href="\/species\/species-42"/);
  assert.doesNotMatch(speciesHTML, /href="\/species\/communis"/);
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
