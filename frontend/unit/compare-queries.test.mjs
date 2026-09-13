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
  readMinusCompareQueriesFromParams,
  sanitizeHiddenCompareQueries,
  searchLiteral,
  writeCompareQueriesToParams,
  writeCompareQuerySetToParams,
  writeHiddenCompareQueriesToParams,
  writeMinusCompareQueriesToParams,
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

test("minus compare queries are restricted to active queries and keep one plus", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));

  const next = writeMinusCompareQueriesToParams(params, [
    "primary",
    "extra one",
    "extra two",
    "stale",
  ]);

  assert.deepEqual(readMinusCompareQueriesFromParams(next), [
    "extra one",
    "extra two",
  ]);
});

test("reading minus compare queries from URL state always leaves one plus", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));
  params.set("cmp_minus", JSON.stringify(["primary", "extra one", "extra two"]));

  assert.deepEqual(readMinusCompareQueriesFromParams(params), [
    "extra one",
    "extra two",
  ]);
});

test("writing minus compare queries removes hidden state that would hide every plus", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one"]));
  params.set("cmp_hidden", JSON.stringify(["primary"]));

  const next = writeMinusCompareQueriesToParams(params, ["extra one"]);

  assert.deepEqual(readMinusCompareQueriesFromParams(next), ["extra one"]);
  assert.deepEqual(readHiddenCompareQueriesFromParams(next), []);
});

test("minus compare queries ignore hidden queries", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));
  params.set("cmp_hidden", JSON.stringify(["extra one"]));
  params.set("cmp_minus", JSON.stringify(["extra one", "extra two"]));

  assert.deepEqual(readMinusCompareQueriesFromParams(params), ["extra two"]);
});

test("removing a compared query also removes its minus state", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));
  params.set("cmp_minus", JSON.stringify(["extra one", "extra two"]));

  const next = writeCompareQueriesToParams(params, ["extra two"]);

  assert.deepEqual(readMinusCompareQueriesFromParams(next), ["extra two"]);
});

test("hidden compare queries keep at least one plus query visible", () => {
  assert.deepEqual(
    sanitizeHiddenCompareQueries(
      ["primary", "minus extra"],
      ["primary", "minus extra"],
      ["minus extra"],
    ),
    [],
  );
});

test("coordinated query rewrites preserve minus state by query slot", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));
  params.set("cmp_minus", JSON.stringify(["primary", "extra two"]));

  const next = writeCompareQuerySetToParams(params, "primary narrowed", [
    "extra one narrowed",
    "extra two narrowed",
  ]);

  assert.deepEqual(readMinusCompareQueriesFromParams(next), [
    "primary narrowed",
    "extra two narrowed",
  ]);
});

test("hidden compare queries always leave one plus query visible", () => {
  const active = ["primary", "extra one", "extra two"];

  assert.deepEqual(
    sanitizeHiddenCompareQueries(
      active,
      ["primary", "extra one"],
      ["extra two"],
    ),
    ["extra one"],
  );
});

test("writing hidden compare queries preserves a visible plus query", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one", "extra two"]));
  params.set("cmp_minus", JSON.stringify(["extra two"]));

  const next = writeHiddenCompareQueriesToParams(params, [
    "primary",
    "extra one",
    "extra two",
  ]);

  assert.deepEqual(readHiddenCompareQueriesFromParams(next), [
    "extra one",
  ]);
});

test("writing hidden compare queries does not hide minus queries", () => {
  const params = new URLSearchParams();
  params.set("query", "primary");
  params.set("cmp", JSON.stringify(["extra one"]));
  params.set("cmp_minus", JSON.stringify(["extra one"]));

  const next = writeHiddenCompareQueriesToParams(params, ["extra one"]);

  assert.deepEqual(readHiddenCompareQueriesFromParams(next), []);
  assert.deepEqual(readMinusCompareQueriesFromParams(next), ["extra one"]);
});
