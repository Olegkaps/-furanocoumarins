import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
after(() => server.close());
const { appendCladeClause, searchLiteral } = await server.ssrLoadModule("/src/SearchApp/compareQueries.ts");

test("search literals escape apostrophes and preserve backticks", () => {
  assert.equal(searchLiteral("O'Brien"), "'O''Brien'");
  assert.equal(searchLiteral("angelicin `alpha`"), "'angelicin `alpha`'");
});

test("tree clade links append escaped search clauses", () => {
  assert.equal(
    appendCladeClause("chemical = 'Bergapten'", "species", "O'Brien `complex`"),
    "chemical = 'Bergapten' AND species = 'O''Brien `complex`'",
  );
});
