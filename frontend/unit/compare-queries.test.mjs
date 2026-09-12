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
const {
  appendCladeClause,
  readHiddenCompareQueriesFromParams,
  searchLiteral,
  writeCompareQueriesToParams,
  writeCompareQuerySetToParams,
  writeHiddenCompareQueriesToParams,
} = await server.ssrLoadModule("/src/SearchApp/compareQueries.ts");

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

test("hidden compare queries are restricted to the active compare set", () => {
  const params = new URLSearchParams();
  params.set("query", "type_structure CONTAINS 'ang'");
  params.set(
    "cmp",
    JSON.stringify(["type_structure CONTAINS 'lin'", "familia = 'Apiaceae'"]),
  );

  const hidden = writeHiddenCompareQueriesToParams(params, [
    "type_structure CONTAINS 'ang'",
    "type_structure CONTAINS 'lin'",
    "stale query",
  ]);

  assert.deepEqual(readHiddenCompareQueriesFromParams(hidden), [
    "type_structure CONTAINS 'ang'",
    "type_structure CONTAINS 'lin'",
  ]);
});

test("removing a compared query also removes its hidden state", () => {
  const params = new URLSearchParams();
  params.set("query", "type_structure CONTAINS 'ang'");
  params.set(
    "cmp",
    JSON.stringify(["type_structure CONTAINS 'lin'", "familia = 'Apiaceae'"]),
  );
  params.set(
    "cmp_hidden",
    JSON.stringify([
      "type_structure CONTAINS 'lin'",
      "familia = 'Apiaceae'",
      "stale query",
    ]),
  );

  const next = writeCompareQueriesToParams(params, ["familia = 'Apiaceae'"]);

  assert.deepEqual(readHiddenCompareQueriesFromParams(next), [
    "familia = 'Apiaceae'",
  ]);
});

test("coordinated query rewrites preserve hidden state by query slot", () => {
  const params = new URLSearchParams();
  params.set("query", "type_structure CONTAINS 'ang'");
  params.set(
    "cmp",
    JSON.stringify(["type_structure CONTAINS 'lin'", "familia = 'Apiaceae'"]),
  );
  params.set(
    "cmp_hidden",
    JSON.stringify([
      "type_structure CONTAINS 'ang'",
      "familia = 'Apiaceae'",
    ]),
  );

  const next = writeCompareQuerySetToParams(params, "primary narrowed", [
    "extra one narrowed",
    "extra two narrowed",
  ]);

  assert.equal(next.get("query"), "primary narrowed");
  assert.deepEqual(readHiddenCompareQueriesFromParams(next), [
    "primary narrowed",
    "extra two narrowed",
  ]);
});
