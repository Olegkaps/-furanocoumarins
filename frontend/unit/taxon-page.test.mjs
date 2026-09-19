import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { taxonChildLabel, taxonPath, speciesPagePath, taxonRouteIsValid } = await server.ssrLoadModule("/src/TaxonPage/taxonPage.ts");

test("a genus page identifies species children by their complete scientific name", () => {
  assert.equal(taxonChildLabel({ rank: 1, name: "Angelica" }, { rank: 0, name: "archangelica" }), "Angelica archangelica");
  assert.equal(taxonChildLabel({ rank: 2, name: "Scandiceae" }, { rank: 1, name: "Angelica" }), "Angelica");
});

test("species IDs take precedence in taxonomy links", () => {
  assert.equal(speciesPagePath("species / 42"), "/species/species%20%2F%2042");
  assert.equal(taxonPath({ rank: 0, name: "archangelica", id: "species / 42" }), "/species/species%20%2F%2042");
  assert.equal(taxonPath({ rank: 1, name: "Angelica" }), "/taxon/1?name=Angelica");
});

test("a species ID route is valid before its source row supplies the display name", () => {
  assert.equal(taxonRouteIsValid("1008210-1", 0, ""), true);
  assert.equal(taxonRouteIsValid(undefined, 0, ""), false);
  assert.equal(taxonRouteIsValid(undefined, 0, "heyniae"), true);
});
