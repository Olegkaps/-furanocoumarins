import test from "node:test";
import assert from "node:assert/strict";
import { buildMetadataPreview, classificationRows, copyCommonColumn, previewQuery, previewValue } from "../src/Admin/metadataPreviewModel.mjs";

const field = (name, options = {}) => ({ name, data_type: "text", ...options });
function document() {
  return { schema_version: 1, importable: true, sheets: [
    { name: "main", columns: [field("species_id", { external_sheet: "classification" }), field("note", { show_in_results: true }), field("chem_id", { external_sheet: "structures" })] },
    { name: "classification", columns: [field("species_id", { primary_key: true }), field("species", { search: true, show_in_results: true }), field("family", { classification: { level: 1 } })] },
    { name: "structures", columns: [field("chem_id", { primary_key: true }), field("chemical", { search: true, show_in_results: true }), field("smiles", { smiles: true })] },
    { name: "publications", columns: [field("unused", { search: true, show_in_results: true })] },
  ] };
}

test("preview follows joins, deduplicates keys, and partitions public panels", () => {
  const model = buildMetadataPreview(document());
  assert.deepEqual(model.errors, []);
  assert.equal(model.columns.filter(c => c.name === "species_id").length, 1);
  assert.deepEqual(model.sourceOnly, ["publications"]);
  assert.deepEqual(model.search.map(c => c.name), ["species", "chemical"]);
  assert.deepEqual(model.results.map(c => c.name), ["note"]);
  assert.deepEqual(model.chemicals.map(c => c.name), ["chemical"]);
  assert.deepEqual(model.species.map(c => c.name), ["species"]);
  assert.deepEqual(model.structures.map(c => c.name), ["smiles"]);
  assert.deepEqual(model.classification.map(c => c.name), ["family"]);
});

test("invalid drafts, missing joins, cycles and conflicting duplicates do not look publishable", () => {
  assert.ok(buildMetadataPreview(undefined).errors.length);
  const missing = document(); missing.sheets[0].columns[0].external_sheet = "absent";
  assert.match(buildMetadataPreview(missing).errors.join(" "), /Missing joined sheet/);
  const cycle = document(); cycle.sheets[1].columns[0].external_sheet = "main";
  assert.match(buildMetadataPreview(cycle).errors.join(" "), /Cyclic join/);
  const conflict = document(); conflict.sheets[1].columns[0].search = true;
  assert.match(buildMetadataPreview(conflict).errors.join(" "), /definitions disagree/);
});

test("hidden fields leave result views; explicit order is numeric and general search is explained", () => {
  const doc = document();
  doc.sheets[0].columns.push(field("ten", { show_in_results: true, result_order: 10 }), field("two", { show_in_results: true, result_order: 2 }), field("zero", { show_in_results: true, result_order: 0 }), field("hidden", { hidden: true, show_in_results: true }), field("general", { search: true }));
  const model = buildMetadataPreview(doc);
  assert.deepEqual(model.results.map(c => c.name), ["zero", "two", "ten", "note"]);
  assert.ok(model.warnings.some(w => w.includes("Search fields need")));
  assert.ok(!model.search.some(c => c.name === "general"));
});

test("sample query follows text/set operators and only includes current preview fields", () => {
  const columns = [field("chemical"), field("tags", { data_type: "set" })];
  assert.equal(previewQuery(columns, { chemical: " O'Brien ", tags: "A+B", stale: "ignored" }), "chemical = 'O''Brien' AND tags CONTAINS 'A+B'");
  assert.equal(previewQuery(columns, { chemical: "  " }), "");
  assert.equal(previewValue(field("tags", { data_type: "set", set_choices: ["one", "two", "three"] })), "value from column tags");
  assert.equal(previewValue(field("tags", { example: null })), "value from column tags");
  assert.equal(previewValue(field("tags", { example: "one, two" })), "one, two");
  assert.equal(previewValue(field("tags", { example: "" })), "");
});

test("publication columns are supported without inventing future search controls", () => {
  const doc = document(); doc.schema_version = 2;
  doc.sheets[0].columns.push(field("unused", { external_sheet: "publications", search: true, show_in_results: true }));
  const model = buildMetadataPreview(doc);
  assert.deepEqual(model.errors, []);
  assert.equal(model.columns.find(c => c.name === "unused").domain, "publication");
  assert.ok(model.results.some(c => c.name === "unused"));
  assert.ok(!model.search.some(c => c.name === "unused"));
});

test("sharing non-key columns preserves their inferred entity and settings", () => {
  const doc = document();
  const source = doc.sheets[1].columns.find(c => c.name === "family");
  const copy = copyCommonColumn("classification", source);
  assert.equal(copy.domain, "species");
  assert.deepEqual(copy.classification, { level: 1 });
  assert.equal(copy.primary_key, false);
  assert.equal(copy.external_sheet, undefined);
  assert.equal(source.domain, undefined);
  doc.sheets[0].columns.push(copy);
  assert.deepEqual(buildMetadataPreview(doc).errors, []);
  assert.equal(copyCommonColumn("structures", field("smiles", { smiles: true })).domain, "chemical");
  assert.equal(copyCommonColumn("publications", field("title")).domain, "publication");
});

test("preview rejects contradictory inferred domains and does not mutate metadata", () => {
  const doc = document(); doc.sheets[1].columns[1].domain = "chemical";
  const before = JSON.stringify(doc);
  assert.match(buildMetadataPreview(doc).errors.join(" "), /entity conflicts/);
  assert.equal(JSON.stringify(doc), before);
});

test("structure previews respect cell rendering precedence and are not duplicated as chemical attributes", () => {
  const doc = document();
  doc.sheets[2].columns.find(c => c.name === "smiles").show_in_results = true;
  let model = buildMetadataPreview(doc);
  assert.ok(!model.chemicals.some(c => c.name === "smiles"));
  assert.deepEqual(model.structures.map(c => c.name), ["smiles"]);
  doc.sheets[2].columns.find(c => c.name === "smiles").link_template = "https://example.test/%s";
  model = buildMetadataPreview(doc);
  assert.ok(model.chemicals.some(c => c.name === "smiles"));
  assert.deepEqual(model.structures, []);
});

test("classification levels descend and equal levels share a row across classification systems", () => {
  const columns = [
    field("genus", { classification: { level: 1, tag: "taxonomy" } }),
    field("family_other", { classification: { level: 10, tag: "taxonomy" } }),
    field("clade", { classification: { level: 10, tag: "phylogeny" } }),
    field("root", { classification: { level: 100 } }),
    field("zero", { classification: { level: 0 } }),
    field("hidden", { classification: { level: 200 }, hidden: true }),
    field("plain"),
  ];
  const before = JSON.stringify(columns);
  assert.deepEqual(classificationRows(columns).map(row => [row.level, row.columns.map(c => c.name)]), [
    [100, ["root"]], [10, ["clade", "family_other"]], [1, ["genus"]], [0, ["zero"]],
  ]);
  assert.equal(JSON.stringify(columns), before);
  assert.deepEqual(classificationRows([]), []);
  const doc = document();
  doc.sheets[1].columns.push(...columns);
  assert.deepEqual(buildMetadataPreview(doc).classification.map(c => c.classification.level), [100, 10, 10, 1, 1, 0]);
});

test("classification lanes stay aligned across missing types and stack same-type columns deterministically", () => {
  const columns = [
    field("z_family", { classification: { level: 10, tag: "taxonomy" } }),
    field("clade", { classification: { level: 10, tag: "phylogeny" } }),
    field("root", { classification: { level: 100 } }),
    field("a_family", { classification: { level: 10, tag: "taxonomy" } }),
    field("genus", { classification: { level: 1, tag: "taxonomy" } }),
    field("hidden", { classification: { level: 20, tag: "hidden system" }, hidden: true }),
  ];
  const rows = classificationRows(columns);
  assert.deepEqual(rows.map(row => row.lanes.map(lane => lane.tag)), [
    ["default", "phylogeny", "taxonomy"], ["default", "phylogeny", "taxonomy"], ["default", "phylogeny", "taxonomy"],
  ]);
  assert.deepEqual(rows.map(row => row.lanes.map(lane => lane.columns.map(c => c.name))), [
    [["root"], [], []], [[], ["clade"], ["a_family", "z_family"]], [[], [], ["genus"]],
  ]);
  assert.deepEqual(classificationRows([...columns].reverse()), rows);
});

test("implicit, empty and explicit default classifications share the first lane", () => {
  const rows = classificationRows([
    field("implicit", { classification: { level: 10 } }),
    field("empty", { classification: { level: 10, tag: "" } }),
    field("explicit", { classification: { level: 10, tag: "default" } }),
    field("named", { classification: { level: 10, tag: "aardvark" } }),
  ]);
  assert.deepEqual(rows[0].lanes.map(lane => [lane.tag, lane.columns.map(c => c.name)]), [
    ["default", ["empty", "explicit", "implicit"]], ["aardvark", ["named"]],
  ]);
});
