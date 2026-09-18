import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildMetadataPreview, entityPageDefaults } from "../src/Admin/metadataPreviewModel.mjs";

// Transform the actual TSX without opening a browser, socket, or file watcher.
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const preview = await server.ssrLoadModule("/src/Admin/MetadataPreview.tsx");
const searchApp = await server.ssrLoadModule("/src/SearchApp/SearchApp.tsx");

const column = (name, options = {}) => ({ name, data_type: "text", ...options });
const document = { schema_version: 2, importable: true, sheets: [
  { name: "main", columns: [
    column("chemical_id", { external_sheet: "structures" }),
    column("species_id", { external_sheet: "classification" }),
    column("citation", { reference: true, show_in_results: true, example: "paper-1" }),
    column("note", { show_in_results: true, example: "<script>unsafe</script>" }),
  ] },
  { name: "structures", columns: [
    column("chemical_id", { primary_key: true }),
    column("chemical", { label: "Chemical", search: true, show_in_results: true, example: "Ethanol" }),
    column("smiles", { smiles: true, example: "CCO" }),
  ] },
  { name: "classification", columns: [
    column("species_id", { primary_key: true }),
    column("species", { label: "Species", search: true, show_in_results: true }),
    column("family", { classification: { level: 10 } }),
    column("genus", { classification: { level: 2, tag: "default" } }),
    column("genus_gbif", { classification: { level: 2, tag: "gbif" } }),
  ] },
] };

test("invalid metadata renders recovery instead of fabricated preview records", () => {
  const html = renderToStaticMarkup(createElement(preview.default, {}));
  assert.match(html, /Preview unavailable/);
  assert.doesNotMatch(html, /<canvas/);
});

test("search preview renders the public search form with safe local examples", () => {
  const html = renderToStaticMarkup(createElement(preview.default, { document }));
  assert.match(html, /class="search-form unified-search"/);
  assert.match(html, /data-tour="search-form"/);
  assert.match(html, /Choose columns \(3\)/);
  assert.match(html, /SMILES substructure/);
  assert.match(html, /data-tour="search-submit"/);
  assert.match(html, /type="checkbox" aria-label="Species"/);
  assert.match(html, /type="checkbox" aria-label="Chemical"/);
  assert.match(html, /type="checkbox" aria-label="citation"/);
  assert.doesNotMatch(html, /type="checkbox" aria-label="smiles"/);
  assert.match(html, /SMILES substructure/);
  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html, />Entity details<\/button>/);
  assert.match(html, />Results table<\/button>/);
});

test("the live search catalog keeps reference types and places them in Publications", () => {
  const catalog = searchApp.searchableMetadataColumns([
    { column: "title", type: "search publication" },
    { column: "reference_id", type: "table_0 ref[]" },
    { column: "hidden_note", type: "table_1" },
  ]);
  assert.deepEqual(catalog.map(column => [column.column, column.type]), [
    ["title", "search publication"], ["reference_id", "table_0 ref[]"],
  ]);
  const html = renderToStaticMarkup(createElement(preview.SearchPreview, { columns: [{ name: "reference_id", sheet: "main", data_type: "text", reference: true, example: "paper-1" }] }));
  assert.match(html, /Publications/);
  assert.match(html, /aria-label="reference_id"/);
});

test("search preview includes reachable publication fields in the public publications group", () => {
  const draft = structuredClone(document);
  draft.sheets[0].columns.push(column("publication_id", { external_sheet: "publications" }));
  draft.sheets.push({ name: "publications", columns: [
    column("publication_id", { primary_key: true }),
    column("publication_title", { label: "Publication title", search: true, example: "Example paper" }),
  ] });
  const html = renderToStaticMarkup(createElement(preview.default, { document: draft }));
  assert.match(html, /Publications/);
  assert.match(html, /aria-label="Publication title"/);
});

test("search preview supports the public generated genus and species control", () => {
  const draft = structuredClone(document);
  const classification = draft.sheets.find(sheet => sheet.name === "classification").columns;
  classification.push(
    column("genus_rank", { label: "Genus", search: true, classification: { level: 1, tag: "default" }, example: "Heracleum" }),
    column("species_rank", { label: "Species rank", search: true, classification: { level: 0, tag: "default" }, example: "sphondylium" }),
  );
  const html = renderToStaticMarkup(createElement(preview.default, { document: draft, onEditColumn() {} }));
  assert.match(html, /aria-label="Species rank \+ Genus"/);
  assert.doesNotMatch(html, /Edit undefined\./);
});

test("results preview includes both selection states, entities, references and SMILES", () => {
  const html = renderToStaticMarkup(createElement(preview.ResultsPreview, { model: buildMetadataPreview(document) }));
  assert.match(html, /aria-label="Before selection"/);
  assert.match(html, /aria-label="After selection"/);
  assert.equal((html.match(/class="side-panel__header"/g) ?? []).length, 4);
  assert.match(html, /Hover or select a chemical/);
  assert.match(html, /Select species or chemical/);
  assert.match(html, /References/);
  assert.match(html, /paper-1/);
  assert.match(html, /<canvas[^>]+aria-label="Molecular structure for smiles"/);
  assert.match(html, /CCO/);
  assert.match(html, /value from column species/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script\b|<a\b|<iframe\b|class="smiles"/);
});

test("entity page previews use public page frames with Markdown and non-navigating taxonomy", () => {
  const draft = structuredClone(document);
  draft.sheets[1].columns.find(c => c.name === "chemical").show_on_chemical_page = true;
  draft.sheets[1].columns.push(column("external_record", { label: "External record", show_on_chemical_page: true, link_template: "https://example.test/%s", example: "record-1" }));
  draft.sheets[2].columns.find(c => c.name === "species").show_on_species_page = true;
  const model = buildMetadataPreview(draft);
  const chemical = renderToStaticMarkup(createElement(preview.EntityPagePreview, { kind: "chemical", columns: model.chemicalPage }));
  assert.match(chemical, /aria-label="Chemical page preview"/);
  assert.match(chemical, /SMILES: CCO/);
  assert.match(chemical, /Example chemical description/);
  assert.match(chemical, /Ethanol/);
  assert.match(chemical, /record-1/);
  assert.doesNotMatch(chemical, /href=/);
  assert.doesNotMatch(chemical, /unsafe/);
  const species = renderToStaticMarkup(createElement(preview.EntityPagePreview, { kind: "species", columns: model.speciesPage }));
  assert.match(species, /aria-label="Species page preview"/);
  assert.match(species, /value from column species/);
  assert.match(species, /Classification rank 0/);
  assert.match(species, /Parent taxon/);
  assert.match(species, /Children/);
  assert.match(species, /Example species description/);
  assert.doesNotMatch(species, /<a\b|>Edit</);
});

test("preview reports checking rather than an invalid definition while the editor validates a parseable draft", () => {
  const html = renderToStaticMarkup(createElement(preview.default, { validating: true }));
  assert.match(html, /Checking draft preview/);
  assert.doesNotMatch(html, /Complete a valid, importable JSON definition/);
});

test("editing a version selects entity detail fields unless search and results already show them", () => {
  const draft = structuredClone(document);
  const structures = draft.sheets[1].columns;
  const classification = draft.sheets[2].columns;
  structures.push(column("results_only", { show_in_results: true }), column("search_only", { search: true }), column("both", { search: true, show_in_results: true }), column("hidden", { hidden: true }));
  classification.push(column("species_note"));
  const edited = entityPageDefaults(draft);
  const find = (sheet, name) => edited.sheets.find(s => s.name === sheet).columns.find(c => c.name === name);
  assert.equal(find("structures", "results_only").show_on_chemical_page, true);
  assert.equal(find("structures", "search_only").show_on_chemical_page, true);
  assert.equal(find("structures", "both").show_on_chemical_page, undefined);
  assert.equal(find("structures", "hidden").show_on_chemical_page, undefined);
  assert.equal(find("classification", "species_note").show_on_species_page, true);
  assert.equal(draft.sheets[1].columns.some(c => c.show_on_chemical_page), false);
});

test("missing examples keep every panel usable without drawing placeholder molecules", () => {
  const draft = structuredClone(document);
  for (const sheet of draft.sheets) for (const c of sheet.columns) c.example = null;
  const html = renderToStaticMarkup(createElement(preview.ResultsPreview, { model: buildMetadataPreview(draft) }));
  assert.match(html, /value from column smiles/);
  assert.match(html, /value from column citation/);
  assert.match(html, /After selection/);
  assert.doesNotMatch(html, /<canvas|Preview unavailable/);
});

test("classification renders descending rows with all equal-level columns together", () => {
  const html = renderToStaticMarkup(createElement(preview.ClassificationPreview, { columns: buildMetadataPreview(document).classification }));
  assert.ok(html.indexOf('data-classification-level="10"') < html.indexOf('data-classification-level="2"'));
  assert.equal((html.match(/data-classification-level="2"/g) ?? []).length, 1);
  const lowerRow = html.slice(html.indexOf('data-classification-level="2"'));
  assert.match(lowerRow, />genus</);
  assert.match(lowerRow, />genus_gbif</);
  assert.match(lowerRow, /Down to level 2/);
});

test("classification centers sparse levels without reserving empty source lanes", () => {
  const html = renderToStaticMarkup(createElement(preview.ClassificationPreview, { columns: buildMetadataPreview(document).classification }));
  const upperStart = html.indexOf('data-classification-level="10"');
  const lowerStart = html.indexOf('data-classification-level="2"');
  const tags = fragment => [...fragment.matchAll(/data-classification-tag="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tags(html.slice(upperStart, lowerStart)), ["default"]);
  assert.deepEqual(tags(html.slice(lowerStart)), ["default", "gbif"]);
});

test("preview provides sheet-qualified editor targets and a collapsed editor toggle", () => {
  const html = renderToStaticMarkup(createElement(preview.default, { document, onEditColumn() {}, onOpenEditor() {} }));
  assert.match(html, /aria-expanded="false" aria-controls="metadata-side-editor"/);
  assert.match(html, /data-preview-sheet="structures" data-preview-column="chemical" aria-label="Edit structures.chemical"/);
  assert.match(html, /data-preview-sheet="classification" data-preview-column="species" aria-label="Edit classification.species"/);
  assert.doesNotMatch(html, />Edit<\/button>/);
  assert.doesNotMatch(html, /<label[^>]*>(?:(?!<\/label>).)*<button/);
});
