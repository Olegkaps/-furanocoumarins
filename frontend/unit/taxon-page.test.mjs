import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { taxonChildLabel } = await server.ssrLoadModule("/src/TaxonPage/taxonPage.ts");

test("a genus page identifies species children by their complete scientific name", () => {
  assert.equal(taxonChildLabel({ rank: 1, name: "Angelica" }, { rank: 0, name: "archangelica" }), "Angelica archangelica");
  assert.equal(taxonChildLabel({ rank: 2, name: "Scandiceae" }, { rank: 1, name: "Angelica" }), "Angelica");
});
