import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const { default: Tree } = await server.ssrLoadModule("/src/SearchApp/PhylogeneticTree.tsx");

test("public tree rank controls follow numeric hierarchy and selected taxonomy", () => {
  const response = { data: [], metadata: [
    { column: "species", name: "Species", type: "search table_specie clas[0]" },
    { column: "genus", name: "Genus", type: "table_specie clas[1]" },
    { column: "family", name: "Family", type: "clas[7]" },
    { column: "accepted_genus", name: "Accepted genus", type: "search clas[1][accepted]" },
  ] };
  const before = structuredClone(response);
  const html = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ["/tree?tag=accepted&from=0&to=2"],
  }, createElement(Tree, { response })));
  const selects = [...html.matchAll(/<select[^>]*>(.*?)<\/select>/g)];
  assert.equal(selects.length, 2);
  for (const [, options] of selects) {
    assert.deepEqual([...options.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(match => match[1]),
      ["1. Family", "2. Accepted genus", "3. Species"]);
  }
  assert.deepEqual(response, before);
});
