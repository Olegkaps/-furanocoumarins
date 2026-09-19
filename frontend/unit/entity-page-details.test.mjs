import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { entityPageColumns, entityPageProjectionChunks, fetchEntityPageDetails, mergeEntityPageRows, rowFromEntitySearch, sourceEntityPageDetails } = await server.ssrLoadModule("/src/SearchApp/entityPageDetails.ts");
const { EntityDetailTable, classificationRowsForSource } = await server.ssrLoadModule("/src/SearchApp/EntityDetailTable.tsx");

test("entity page projections reject missing and ambiguous records", () => {
  const metadata = [{ column: "name", name: "Name", description: "", type: "chemical_page chemical" }];
  assert.equal(rowFromEntitySearch({ metadata, data: [] }, "name"), null);
  assert.equal(rowFromEntitySearch({ metadata, data: [{ name: "one" }, { name: "two" }] }, "name"), null);
  assert.deepEqual([...rowFromEntitySearch({ metadata, data: [{ name: "one", aliases: ["a", "b"] }] }, "name")], [["name", "one"], ["aliases", "a, b"]]);
  assert.deepEqual([...rowFromEntitySearch({ metadata, data: [
    { name: "one", cas: "", aliases: ["a"] },
    { name: "one", cas: "12-34-5", aliases: ["a"] },
  ] }, "name")], [["name", "one"], ["cas", "12-34-5"], ["aliases", "a"]]);
  assert.equal(rowFromEntitySearch({ metadata, data: [
    { name: "one", cas: "12-34-5" },
    { name: "one", cas: "99-99-9" },
  ] }, "name"), null);
});

test("catalog-only records retain their source identity and searchable fields", () => {
  const detail = sourceEntityPageDetails({
    kind: "chemicals",
    columns: [
      { column: "smiles", name: "SMILES", description: "", type: "SMILES chemical_page chemical" },
      { column: "id", name: "ID", description: "", type: "primary search chemical" },
      { column: "names", name: "Names", description: "", type: "search chemical" },
      { column: "hidden", name: "Hidden", description: "", type: "invisible chemical" },
    ],
    item: { smiles: "CCO", id: "42", names: "Source-only compound", hidden: "no" },
  }, "chemical");
  assert.deepEqual(detail?.meta.map(column => column.name), ["smiles", "id", "names"]);
  assert.equal(detail?.row.get("names"), "Source-only compound");
});

test("entity page detail projections stay within the search column limit and merge only one identity", () => {
  const columns = ["smiles", ...Array.from({ length: 25 }, (_, index) => `detail_${index}`)].map(name => ({ name }));
  assert.deepEqual(entityPageProjectionChunks(columns, "smiles"), [
    ["smiles", "detail_0", "detail_1", "detail_2", "detail_3", "detail_4", "detail_5", "detail_6"],
    ["smiles", "detail_7", "detail_8", "detail_9", "detail_10", "detail_11", "detail_12", "detail_13"],
    ["smiles", "detail_14", "detail_15", "detail_16", "detail_17", "detail_18", "detail_19", "detail_20"],
    ["smiles", "detail_21", "detail_22", "detail_23", "detail_24"],
  ]);
  assert.deepEqual(entityPageProjectionChunks([{ name: "smiles" }], "smiles"), [["smiles"]]);
  const response = data => ({ metadata: [], data, timestamp: "2026-09-18T12:00:00Z" });
  const merged = mergeEntityPageRows([
    response([{ smiles: "CCO", detail_0: "first" }]),
    response([{ smiles: "CCO", detail_7: "second" }]),
  ], "smiles", "2026-09-18T12:00:00Z");
  assert.deepEqual([...merged], [["smiles", "CCO"], ["detail_0", "first"], ["detail_7", "second"]]);
  assert.equal(mergeEntityPageRows([response([{ smiles: "CCO" }]), response([{ smiles: "CCC" }])], "smiles", "2026-09-18T12:00:00Z"), null);
  assert.deepEqual([...mergeEntityPageRows([response([{ smiles: "CCO" }]), response([{ smiles: "CCO" }, { smiles: "CCO" }])], "smiles", "2026-09-18T12:00:00Z")], [["smiles", "CCO"]]);
  assert.equal(mergeEntityPageRows([{ ...response([{ smiles: "CCO" }]), timestamp: "2026-09-18T12:01:00Z" }], "smiles", "2026-09-18T12:00:00Z"), null);
});

test("chemical and species detail loading is sequential, bounded, and cancellable", async () => {
  const metadata = kind => ({ timestamp: "2026-09-18T12:00:00Z", metadata: [
    { column: "identity", name: "Identity", description: "", type: kind === "chemical" ? "SMILES chemical" : "specie" },
    ...Array.from({ length: 25 }, (_, index) => ({ column: `detail_${index}`, name: `Detail ${index}`, description: "", type: kind === "chemical" ? "chemical_page chemical" : "species_page specie" })),
  ] });
  const chemicalMetadata = metadata("chemical");
  const controller = new AbortController();
  const requests = [];
  let active = 0;
  const detail = await fetchEntityPageDetails(chemicalMetadata, "chemical", "identity", "CCO", controller.signal, async (params, signal) => {
    assert.equal(signal, controller.signal);
    assert.ok(params.columns.split(",").length <= 8);
    assert.equal(active, 0);
    active++;
    requests.push(params);
    active--;
    return { metadata: [], timestamp: chemicalMetadata.timestamp, data: [{ identity: "CCO", [params.columns.split(",").at(-1)]: "value" }] };
  });
  assert.equal(requests.length, 4);
  assert.equal(detail?.row.get("detail_24"), "value");
  const speciesMetadata = metadata("species");
  const species = await fetchEntityPageDetails(speciesMetadata, "species", "identity", "Cordifolium", new AbortController().signal, async params => ({ metadata: [], timestamp: speciesMetadata.timestamp, data: [{ identity: "Cordifolium", [params.columns.split(",").at(-1)]: "value" }] }));
  assert.equal(species?.row.get("detail_24"), "value");
  const aborted = new AbortController();
  let abortedRequests = 0;
  assert.equal(await fetchEntityPageDetails(chemicalMetadata, "chemical", "identity", "CCO", aborted.signal, async params => {
    abortedRequests++;
    if (abortedRequests === 2) aborted.abort();
    return { metadata: [], timestamp: chemicalMetadata.timestamp, data: [{ identity: "CCO", [params.columns.split(",").at(-1)]: "late" }] };
  }), null);
  assert.equal(abortedRequests, 2);
});

test("species details use explicit and same-rank default classifications without displaying support columns", async () => {
  const metadata = { timestamp: "2026-09-18T12:00:00Z", metadata: [
    { column: "species_original", name: "Species", description: "", type: "specie clas[0]" },
    { column: "genus_original", name: "Genus", description: "", type: "specie clas[1][original]" },
    { column: "genus_powo", name: "POWO genus", description: "", type: "specie clas[1][powo] species_page" },
    { column: "family_original", name: "Family", description: "", type: "specie clas[4][original]" },
    { column: "family_powo", name: "POWO family", description: "", type: "specie clas[4][powo] species_page" },
    { column: "tribe_pimenov", name: "Pimenov tribe", description: "", type: "specie clas[3][pimenov] species_page default[tribe_original]" },
    { column: "tribe_original", name: "Tribe", description: "", type: "specie clas[3]" },
  ] };
  assert.deepEqual(entityPageColumns(metadata.metadata, "species").map(column => column.name), ["family_powo", "tribe_pimenov", "genus_powo"]);
  const requests = [];
  const detail = await fetchEntityPageDetails(metadata, "species", "species_original", "cordifolium", new AbortController().signal, async params => {
    requests.push(params.columns.split(","));
    return {
      metadata: [], timestamp: metadata.timestamp, data: [{
        species_original: "cordifolium",
        genus_original: "Angelica",
        genus_powo: "NoValue",
        family_original: "Apiaceae",
        family_powo: "",
        tribe_original: "Selineae",
        tribe_pimenov: "Pimpinelleae",
      }],
    };
  });
  assert.ok(requests.flat().includes("genus_original"));
  assert.ok(requests.flat().includes("family_original"));
  assert.ok(requests.flat().includes("tribe_original"));
  assert.deepEqual(detail?.meta.map(column => column.name), ["family_powo", "tribe_pimenov", "genus_powo"]);
  assert.equal(detail?.row.get("family_powo"), "Apiaceae");
  assert.equal(detail?.row.get("genus_powo"), "Angelica");
  assert.equal(detail?.row.get("tribe_pimenov"), "Pimpinelleae");
});

test("species details use one global classification source with original fallbacks", () => {
  const metadata = [
    { column: "family_original", name: "Family", description: "", type: "specie clas[4] species_page" },
    { column: "family_powo", name: "POWO family", description: "", type: "specie clas[4][powo] species_page" },
    { column: "tribe_original", name: "Tribe", description: "", type: "specie clas[3][original] species_page" },
    { column: "tribe_pimenov", name: "Pimenov tribe", description: "", type: "specie clas[3][pimenov] species_page" },
    { column: "author", name: "Author", description: "", type: "specie species_page" },
  ];
  const html = renderToStaticMarkup(createElement(EntityDetailTable, {
    meta: entityPageColumns(metadata, "species"),
    row: new Map(Object.entries({ family_original: "Apiaceae", family_powo: "POWO Apiaceae", tribe_original: "Selineae", tribe_pimenov: "Pimpinelleae", author: "L." })),
    hideEmpty: true,
  }));
  assert.equal((html.match(/aria-label="Classification source"/g) ?? []).length, 1);
  assert.match(html, /<option value="original" selected="">Original<\/option>/);
  assert.match(html, /<option value="powo">powo<\/option>/);
  assert.match(html, /<option value="pimenov">pimenov<\/option>/);
  assert.match(html, />Apiaceae</);
  assert.match(html, />Selineae</);
  assert.match(html, />L\.</);
  assert.doesNotMatch(html, />POWO Apiaceae</);
  assert.doesNotMatch(html, />Pimpinelleae</);
  assert.deepEqual(classificationRowsForSource(entityPageColumns(metadata, "species"), "powo").map(column => column.name), ["family_powo", "tribe_original"]);
  assert.deepEqual(classificationRowsForSource(entityPageColumns(metadata, "species"), "pimenov").map(column => column.name), ["family_original", "tribe_pimenov"]);
});
