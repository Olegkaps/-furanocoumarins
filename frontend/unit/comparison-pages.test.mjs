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
  plugins: [{
    name: "comparison-page-fixture",
    enforce: "pre",
    load(id) {
      if (id.endsWith("/FullNavigation.tsx")) return "export default function FullNavigation() { return null; }";
      if (id.endsWith("/PageTour.tsx")) return "export function PageTour() { return null; }";
      if (id.endsWith("/QueryCompareBar.tsx")) return `
        let fixture;
        export function setFixture(value) { fixture = value; }
        export function useCompareSeries() { return fixture; }
        export function QueryCompareBar() { return null; }
      `;
    },
  }],
});
after(() => server.close());
const { setFixture } = await server.ssrLoadModule("/src/SearchApp/QueryCompareBar.tsx");
const { AppResultTable } = await server.ssrLoadModule("/src/SearchApp/ResultTablePage.tsx");
const { AppPhilogeneticTree } = await server.ssrLoadModule("/src/SearchApp/TreePage.tsx");

const metadata = [
  { column: "species", name: "Species", type: "table_specie keycolumn clas[0]", description: "" },
  { column: "accepted", name: "Accepted", type: "clas[0][accepted]", description: "" },
  { column: "chemical", name: "Chemical", type: "table_chemical keycolumn", description: "" },
];
const empty = { metadata, data: [] };
const extra = { metadata, data: [
  { species: "one", accepted: "same", chemical: "x" },
  { species: "two", accepted: "same", chemical: "y" },
] };
function fixture(response = extra) {
  setFixture({
    series: [
      { query: "empty", mode: "plus", color: "red", response: empty },
      { query: "extra", mode: "plus", color: "green", response },
    ],
    colorsByQuery: {}, primaryRaw: empty, hiddenQueries: [], minusQueries: [],
  });
}
const render = (Component, tag = "original") => renderToStaticMarkup(createElement(
  MemoryRouter, { initialEntries: [`/table?query=empty&tag=${tag}`] }, createElement(Component),
));

test("pages retain navigation when empty primary has nonempty later plus results", () => {
  fixture();
  assert.match(render(AppResultTable), /href="\/tree\?/);
  assert.match(render(AppPhilogeneticTree), /href="\/table\?/);
});

test("table page disables tree navigation for the selected single-taxon projection", () => {
  fixture();
  const html = render(AppResultTable, "accepted");
  assert.match(html, /role="link" aria-disabled="true"/);
  assert.doesNotMatch(html, /href="\/tree\?/);
});

test("pages omit result navigation when every visible plus response is empty", () => {
  fixture(empty);
  assert.doesNotMatch(render(AppResultTable), /href="\/tree\?/);
  assert.doesNotMatch(render(AppPhilogeneticTree), /href="\/table\?/);
});
