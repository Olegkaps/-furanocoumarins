import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const { default: OmicsRecordList } = await server.ssrLoadModule("/src/TaxonPage/OmicsRecordList.tsx");

test("provider list starts collapsed and includes every record beyond the old three-row limit", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    accession: `GCA_${index}`, label: `Genome ${index}`, species: "Heracleum sphondylium",
    href: `https://www.ncbi.nlm.nih.gov/datasets/genome/GCA_${index}/`,
  }));
  const html = renderToStaticMarkup(createElement(OmicsRecordList, { name: "NCBI", count: 12, records }));
  assert.match(html, /<details class="omics-record-list">/);
  assert.match(html, /<summary><span>NCBI<\/span><small>12<\/small><\/summary>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 12);
  assert.match(html, /Genome 11/);
  assert.match(html, /GCA_11 · Heracleum sphondylium/);
  assert.doesNotMatch(html, /Showing first/);
});

test("empty provider list identifies a real zero without a placeholder link", () => {
  const html = renderToStaticMarkup(createElement(OmicsRecordList, { name: "ENA", count: 0, records: [] }));
  assert.match(html, /<small>0<\/small>/);
  assert.match(html, /No matching records/);
  assert.doesNotMatch(html, /<a /);
});
