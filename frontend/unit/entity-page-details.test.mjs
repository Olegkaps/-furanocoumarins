import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { rowFromEntitySearch } = await server.ssrLoadModule("/src/SearchApp/entityPageDetails.ts");

test("entity page projections reject missing and ambiguous records", () => {
  const metadata = [{ column: "name", name: "Name", description: "", type: "chemical_page chemical" }];
  assert.equal(rowFromEntitySearch({ metadata, data: [] }), null);
  assert.equal(rowFromEntitySearch({ metadata, data: [{ name: "one" }, { name: "two" }] }), null);
  assert.deepEqual([...rowFromEntitySearch({ metadata, data: [{ name: "one", aliases: ["a", "b"] }] })], [["name", "one"], ["aliases", "a, b"]]);
});
