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
const { queryColumns, queryContext, querySuggestions, applyQuerySuggestion, queryValueRequestKey, scheduleQueryValues, completionKey } =
  await server.ssrLoadModule("/src/SearchApp/queryCompletion.ts");
const { QueryInput } = await server.ssrLoadModule("/src/SearchApp/QueryInput.tsx");
const columns = queryColumns([
  { column: "names", name: "Trivial name(s)", type: "search table_2 chemical" },
  { column: "familia", name: "Family", type: "clas[7] specie" },
  { column: "subfamily", type: "clas[6] specie" },
  { column: "type_structure", type: "search invisible set[ang lin non] chemical" },
  { column: "aliases", type: "set chemical" },
]);
const context = (value, caret = value.length) => queryContext(value, caret, columns);
const labels = (value, values = []) => querySuggestions(context(value), columns, values).map(s => s.label);

test("all registered identifiers are offered, irrespective of guided search and visibility flags", () => {
  assert.deepEqual(labels(""), ["(", "names", "familia", "subfamily", "type_structure", "aliases"]);
  assert.deepEqual(labels("fam"), ["familia"]);
  assert.deepEqual(queryColumns([null, {}, { column: "bad;name", type: "search" }, { column: "_private", type: "search" }]), []);
  assert.deepEqual(queryColumns(null), []);
});

test("operators match physical text/set semantics", () => {
  assert.deepEqual(labels("names "), ["=", "!=", "<", ">", "<=", ">=", "LIKE"]);
  assert.deepEqual(labels("names <"), ["<", "<="]);
  assert.deepEqual(labels("type_structure "), ["CONTAINS"]);
  assert.deepEqual(labels("aliases "), ["CONTAINS"]);
  assert.deepEqual(labels("familia LI"), ["LIKE"]);
  assert.deepEqual(labels("names CONTAINS ", ["bad"]), []);
  assert.deepEqual(labels("aliases = ", ["bad"]), []);
  assert.deepEqual(labels("names like ", ["bad"]), []);
});

test("selecting an operator inserts quotes with the caret inside for text and sets", () => {
  for (const query of ["names ", "type_structure "]) {
    const ctx = context(query);
    for (const suggestion of querySuggestions(ctx, columns)) {
      const result = applyQuerySuggestion(query, ctx, suggestion);
      assert.equal(result.value, `${query}${suggestion.insert} '' `);
      assert.equal(result.value[result.caret - 1], "'");
      assert.equal(result.value[result.caret], "'");
      assert.equal(context(result.value, result.caret).kind, "value");
    }
  }
});

test("operator replacement preserves an existing quoted value and following conditions", () => {
  const query = "names = 'Neo' AND familia = 'Apiaceae'";
  const result = applyQuerySuggestion(query, context(query, 7), { insert: "LIKE" });
  assert.equal(result.value, "names LIKE 'Neo' AND familia = 'Apiaceae'");
  assert.equal(result.value.slice(result.caret), "Neo' AND familia = 'Apiaceae'");
});

test("operator insertion preserves a following closing parenthesis", () => {
  const query = "(names )";
  const result = applyQuerySuggestion(query, context(query, 7), { insert: "=" });
  assert.equal(result.value, "(names = '' )");
  assert.equal(result.value.slice(result.caret), "' )");
});

test("remote lookups require a nonblank dynamic value prefix; finite sets remain local", () => {
  for (const query of ["names = ", "names = '", "names = '  ", "names ", "type_structure CONTAINS 'a"]) {
    assert.equal(queryValueRequestKey(context(query)), "", query);
  }
  assert.deepEqual(JSON.parse(queryValueRequestKey(context("aliases CONTAINS 'O''B"))), ["aliases", "O'B"]);
  assert.deepEqual(JSON.parse(queryValueRequestKey(context("names LIKE 'Neo"))), ["names", "Neo"]);
});

test("completed keywords require uppercase, while partial completions insert uppercase", () => {
  for (const query of ["names like ", "aliases contains ", "names='x' and ", "names='x' or "]) {
    assert.equal(context(query).kind, "invalid", query);
    assert.deepEqual(labels(query, ["value"]), []);
  }
  assert.deepEqual(labels("names li"), ["LIKE"]);
  assert.deepEqual(labels("names='x' an"), ["AND"]);
  const query = "names='x' an";
  const ctx = context(query);
  const completed = applyQuerySuggestion(query, ctx, querySuggestions(ctx, columns)[0]).value;
  assert.equal(completed, "names='x' AND ");
  assert.equal(context(completed).kind, "column");
});

test("a token starting at the caret wins a shared boundary without losing end-of-column completion", () => {
  const query = "names='x' AND familia='Apiaceae'";
  const ctx = context(query, 6);
  assert.equal(ctx.kind, "value");
  assert.equal(ctx.start, 6);
  assert.equal(ctx.end, 9);
  assert.equal(ctx.prefix, "");
  const [suggestion] = querySuggestions(ctx, columns, ["O'Brien"]);
  assert.equal(applyQuerySuggestion(query, ctx, suggestion).value, "names= 'O''Brien' AND familia='Apiaceae'");
  assert.equal(context(query, 5).kind, "operator");
  assert.equal(context("names").kind, "column");
  assert.deepEqual(labels("names"), ["names"]);
  assert.equal(context("names ", 5).kind, "column");
  assert.equal(context("names ").kind, "operator");
});

test("finite choices and dynamic values are filtered, deduplicated, bounded and safely quoted", () => {
  assert.deepEqual(labels("type_structure CONTAINS 'a"), ["ang"]);
  assert.deepEqual(labels("aliases CONTAINS 'o", ["O'Brien", "O'Brien", null, 2]), ["O'Brien"]);
  const ctx = context("names = 'O");
  const [suggestion] = querySuggestions(ctx, columns, ["O'Brien"]);
  assert.equal(applyQuerySuggestion("names = 'O", ctx, suggestion).value, "names = 'O''Brien' ");
  assert.equal(labels("names = ", Array.from({ length: 100 }, (_, i) => `${i}`)).length, 12);
  assert.deepEqual(labels("names = ", { values: ["bad"] }), []);
});

test("clauses and nested groups offer only valid continuations", () => {
  assert.deepEqual(labels("familia='Apiaceae'"), ["AND", "OR"]);
  assert.deepEqual(labels("(familia='Apiaceae'"), ["AND", "OR", ")"]);
  assert.deepEqual(labels("((familia='Apiaceae')"), ["AND", "OR", ")"]);
  assert.deepEqual(labels("(familia='Apiaceae')"), ["AND", "OR"]);
  assert.deepEqual(labels("names LIKE 'Neo%' OR ("), labels(""));
  assert.deepEqual(labels("names='O''Brien AND (sons)' A"), ["AND"]);
  assert.deepEqual(labels("names='x') "), []);
  assert.deepEqual(labels("names='x' AND ) "), []);
  assert.deepEqual(labels("names = unquoted "), []);
});

test("completion replaces the token around the caret and preserves following clauses", () => {
  const query = "familia='Apiaceae' OR names = 'wrong' AND subfamily = 'A'";
  const caret = query.indexOf("wrong") + 2;
  const ctx = context(query, caret);
  const suggestion = { label: "O'Brien", insert: "'O''Brien'" };
  const result = applyQuerySuggestion(query, ctx, suggestion);
  assert.equal(result.value, "familia='Apiaceae' OR names = 'O''Brien' AND subfamily = 'A'");
  assert.equal(result.value.slice(result.caret), " AND subfamily = 'A'");
  assert.equal(ctx.prefix, "wr");
  const middle = "names = 'A' OR familia = 'B'";
  assert.equal(applyQuerySuggestion(middle, context(middle, 2), { insert: "subfamily" }).value, "subfamily = 'A' OR familia = 'B'");
  assert.equal(applyQuerySuggestion(middle, context(middle, 0), { insert: "subfamily" }).value, "subfamily = 'A' OR familia = 'B'");
});

test("arrows wrap; Enter consumes a selected option and otherwise permits submission", () => {
  assert.deepEqual(completionKey("ArrowDown", -1, 3), { active: 0, choose: false, handled: true });
  assert.equal(completionKey("ArrowUp", -1, 3).active, 2);
  assert.equal(completionKey("ArrowDown", 2, 3).active, 0);
  assert.equal(completionKey("Enter", 0, 3).handled, true);
  assert.equal(completionKey("Enter", 0, 3).choose, true);
  assert.equal(completionKey("Enter", -1, 3).handled, false);
  assert.equal(completionKey("Enter", 0, 0).handled, false);
});

test("debounce cancellation prevents a request from starting", async () => {
  let calls = 0;
  const cancel = scheduleQueryValues(async () => { calls++; return []; }, () => assert.fail("cancelled result"), 5);
  cancel();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 0);
});

test("cleanup aborts the transport and suppresses stale responses even when abort is ignored", async () => {
  let finish, signal;
  const received = [];
  const cancel = scheduleQueryValues(s => { signal = s; return new Promise(resolve => { finish = resolve; }); }, v => received.push(v), 0);
  await new Promise(resolve => setTimeout(resolve, 10));
  cancel();
  assert.equal(signal.aborted, true);
  finish(["old"]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(received, []);
});

for (const reason of ["Escape", "blur", "superseded input"]) {
  test(`${reason} cleanup suppresses a late rejected request`, async () => {
    let reject;
    const received = [];
    const cancel = scheduleQueryValues(() => new Promise((_, fail) => { reject = fail; }), v => received.push(v), 0);
    await new Promise(resolve => setTimeout(resolve, 10));
    cancel();
    reject(new Error("late failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(received, []);
  });
}

test("request errors produce an empty result and successful values are delivered", async () => {
  const results = [];
  scheduleQueryValues(async () => { throw new Error("offline"); }, v => results.push(v), 0);
  scheduleQueryValues(async () => ["fresh"], v => results.push(v), 0);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(results, [[], ["fresh"]]);
});

test("shared input renders a labelled combobox while preserving parent attributes", () => {
  const html = renderToStaticMarkup(createElement(QueryInput, {
    value: "names='x'", onChange() {}, "aria-label": "Search query", className: "search-teaxtarea", disabled: true,
  }));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Search query"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /aria-activedescendant/);
});
