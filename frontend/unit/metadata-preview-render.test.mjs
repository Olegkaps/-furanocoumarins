import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildMetadataPreview } from "../src/Admin/metadataPreviewModel.mjs";

// Transform the actual TSX without opening a browser, socket, or file watcher.
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const preview = await server.ssrLoadModule("/src/Admin/MetadataPreview.tsx");

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
  assert.match(html, /class="search-form/);
  assert.match(html, /class="section-toggle"/);
  assert.match(html, /class="autocomplete-input"/);
  assert.match(html, /<input[^>]*aria-label="Chemical"/);
  assert.match(html, /<li[^>]+style="width:400px;position:relative"/);
  assert.match(html, /class="autocomplete-container"[^>]+style="[^"]*left:20%;width:300px;height:30px/);
  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html, />Entity details<\/button>/);
  assert.match(html, />Results table<\/button>/);
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
  assert.doesNotMatch(html, /<label[^>]*>.*<button/);
});
