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
const { insertDelimiter, registerAutoQuotePair, removePairedDelimiter, reconcileDelimiterPairs, replaceSuggestionWithDelimiter, typeAutoClosingQuote } = await server.ssrLoadModule("/src/SearchApp/queryDelimiters.ts");
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

test("typed query delimiters pair, wrap selections, and remove only tracked counterparts", () => {
  let pairs = [];
  let edit = insertDelimiter("", 0, 0, "(", pairs);
  assert.deepEqual(edit.value, "()");
  assert.equal(edit.caret, 1);
  pairs = edit.pairs;
  assert.equal(removePairedDelimiter(edit.value, 1, "Backspace", pairs).value, "");
  edit = insertDelimiter("names", 0, 5, "'", []);
  assert.equal(edit.value, "'names'");
  assert.equal(edit.caret, 1);
  const manual = removePairedDelimiter("()", 1, "Backspace", []);
  assert.equal(manual, null);
});

test("selecting the opening-parenthesis completion creates a tracked closing delimiter", () => {
  const query = "";
  const ctx = context(query);
  const suggestion = querySuggestions(ctx, columns).find(({ insert }) => insert === "(");
  assert.ok(suggestion);
  const edit = replaceSuggestionWithDelimiter(query, ctx.start, ctx.end, suggestion.insert, []);
  assert.deepEqual(edit, { value: "() ", caret: 1, pairs: [{ open: 0, close: 1, delimiter: "(" }] });
  assert.equal(removePairedDelimiter(edit.value, edit.caret, "Backspace", edit.pairs).value, " ");
});

test("selecting opening-parenthesis completion inside its typed automatic pair keeps one pair", () => {
  const typed = insertDelimiter("", 0, 0, "(", []);
  const ctx = context(typed.value, typed.caret);
  const suggestion = querySuggestions(ctx, columns).find(({ insert }) => insert === "(");
  assert.ok(suggestion);
  const edit = replaceSuggestionWithDelimiter(typed.value, ctx.start, ctx.end, suggestion.insert, typed.pairs);
  assert.deepEqual(edit, { value: "() ", caret: 1, pairs: [{ open: 0, close: 1, delimiter: "(" }] });
  assert.equal(removePairedDelimiter(edit.value, edit.caret, "Backspace", edit.pairs).value, " ");
});

test("quotes inside literals insert a complete apostrophe escape and pair positions survive ordinary typing", () => {
  let edit = insertDelimiter("", 0, 0, "'", []);
  let pairs = reconcileDelimiterPairs(edit.value, "'O'", edit.pairs);
  edit = typeAutoClosingQuote("'O'", 2, pairs);
  assert.equal(edit.value, "'O'''");
  assert.equal(edit.caret, 4);
  pairs = reconcileDelimiterPairs(edit.value, "'O''Brien'", edit.pairs);
  assert.deepEqual(pairs, [{ open: 0, close: 9, delimiter: "'" }, { open: 2, close: 3, delimiter: "'" }]);
  assert.equal(removePairedDelimiter("'O''Brien'", 3, "Backspace", pairs).value, "'OBrien'");
});

test("new delimiters rebase existing pairs before, inside, and around a selection", () => {
  const pair = [{ open: 0, close: 1, delimiter: "(" }];
  let edit = insertDelimiter("()", 0, 0, "(", pair);
  assert.deepEqual(edit, { value: "()()", caret: 1, pairs: [{ open: 2, close: 3, delimiter: "(" }, { open: 0, close: 1, delimiter: "(" }] });
  edit = insertDelimiter("()", 1, 1, "(", pair);
  assert.deepEqual(edit, { value: "(())", caret: 2, pairs: [{ open: 0, close: 3, delimiter: "(" }, { open: 1, close: 2, delimiter: "(" }] });
  edit = insertDelimiter("()", 0, 2, "'", pair);
  assert.deepEqual(edit, { value: "'()'", caret: 1, pairs: [{ open: 1, close: 2, delimiter: "(" }, { open: 0, close: 3, delimiter: "'" }] });
});

test("replacement query text clears stale automatic delimiter pairs", () => {
  const stale = reconcileDelimiterPairs("()", "names = 'x'", [{ open: 0, close: 1, delimiter: "(" }]);
  assert.deepEqual(stale, []);
  assert.equal(removePairedDelimiter("names = 'x'", 1, "Delete", stale), null);
});

test("operator suggestions register their generated quote pair for either deletion key", () => {
  const query = "names ";
  const result = applyQuerySuggestion(query, context(query), { insert: "=" });
  const pairs = registerAutoQuotePair(result.value, result.caret, []);
  assert.deepEqual(pairs, [{ open: result.caret - 1, close: result.caret, delimiter: "'" }]);
  assert.equal(removePairedDelimiter(result.value, result.caret, "Backspace", pairs).value, "names =  ");
  assert.equal(removePairedDelimiter(result.value, result.caret - 1, "Delete", pairs).value, "names =  ");
});

test("operators match physical text/set semantics", () => {
  assert.deepEqual(labels("names "), ["CONTAINS", "=", "!=", "<", ">", "<=", ">=", "LIKE"]);
  assert.deepEqual(labels("names <"), ["<", "<="]);
  assert.deepEqual(labels("type_structure "), ["CONTAINS"]);
  assert.deepEqual(labels("aliases "), ["CONTAINS"]);
  assert.deepEqual(labels("familia LI"), ["LIKE"]);
  assert.deepEqual(labels("names CONTAINS ", ["Skimmetine"]), ["Skimmetine"]);
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

test("remote lookups require a nonblank value prefix, including enum columns", () => {
  for (const query of ["names = ", "names = '", "names = '  ", "names "]) {
    assert.equal(queryValueRequestKey(context(query)), "", query);
  }
  assert.deepEqual(JSON.parse(queryValueRequestKey(context("type_structure CONTAINS 'a"))), ["type_structure", "a"]);
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
  assert.equal(applyQuerySuggestion(query, ctx, suggestion).value, "names CONTAINS 'O''Brien' AND familia='Apiaceae'");
  assert.equal(context(query, 5).kind, "operator");
  assert.equal(context("names").kind, "column");
  assert.deepEqual(labels("names"), ["names"]);
  assert.equal(context("names ", 5).kind, "column");
  assert.equal(context("names ").kind, "operator");
});

test("server-ranked fuzzy values are preserved, deduplicated, bounded and safely quoted", () => {
  assert.deepEqual(labels("type_structure CONTAINS 'agn", ["ang"]), ["ang"]);
  assert.deepEqual(labels("names = 'psorlaen", ["Psoralen", "Isopsoralen"]), ["Psoralen", "Isopsoralen"]);
  assert.deepEqual(labels("aliases CONTAINS 'o", ["O'Brien", "O'Brien", null, 2]), ["O'Brien"]);
  const ctx = context("names = 'O");
  const [suggestion] = querySuggestions(ctx, columns, ["O'Brien"]);
  assert.equal(applyQuerySuggestion("names = 'O", ctx, suggestion).value, "names CONTAINS 'O''Brien' ");
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
  assert.equal(result.value, "familia='Apiaceae' OR names CONTAINS 'O''Brien' AND subfamily = 'A'");
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

test("SMILES supports substructure predicates with named options and preserves following conditions", () => {
  const cols = queryColumns([{column:"smiles", name:"Structure", type:"chemical SMILES"}]);
  assert.ok(querySuggestions(queryContext("smiles ", 7, cols), cols).some(s => s.label === "SUBSTRUCTURE"));
  const query = "smiles SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false] 'C1CCCCC1' AND smiles = 'CC'";
  const caret = query.indexOf("C1CCC") + 4;
  const ctx = queryContext(query, caret, cols);
  assert.equal(ctx.kind, "value");
  assert.equal(ctx.prefix, "C1CC");
  assert.equal(ctx.column.column, "smiles");
  assert.equal(query.slice(ctx.operatorStart, ctx.operatorEnd), "SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false]");
  const replaced = applyQuerySuggestion(query, ctx, {label:"c1ccccc1",insert:"'c1ccccc1'"});
  assert.ok(replaced.value.endsWith(" AND smiles = 'CC'"));
});

test("a fresh structure clause does not inherit the previous operator", () => {
  const cols = queryColumns([{column:"smiles", type:"SMILES chemical"}]);
  const query = "smiles = 'CC' AND smiles ";
  const ctx = queryContext(query, query.length, cols);
  assert.equal(ctx.kind, "operator");
  assert.equal(ctx.operatorStart, undefined);
  assert.equal(ctx.operator, undefined);
});

const { structureOperator, parseStructureOptions } = await server.ssrLoadModule("/src/SearchApp/StructureOptions.tsx");
test("all structure modes serialize compactly and read legacy URLs", () => {
  for (let mask = 0; mask < 8; mask++) {
    const options = { bond_order: !!(mask & 1), hetero_atoms: !!(mask & 2), stereochemistry: !!(mask & 4) };
    assert.deepEqual(parseStructureOptions(structureOperator(options)), options);
    assert.deepEqual(parseStructureOptions(`SUBSTRUCTURE[bond_multiplicity=${options.bond_order},hetero_atoms=${options.hetero_atoms},stereochemistry=${options.stereochemistry}]`), options);
  }
  assert.equal(structureOperator(parseStructureOptions()), "SUBSTRUCTURE");
});
test("parameter completion enters brackets and preserves literal and following clauses", () => {
  const cols = queryColumns([{column:"smiles", type:"SMILES chemical"}]);
  const query = "smiles SUB 'CC' AND smiles = 'N'";
  const ctx = queryContext(query, query.indexOf("SUB") + 3, cols);
  const choice = querySuggestions(ctx, cols).find(s => s.insert === "SUBSTRUCTURE[]");
  const entered = applyQuerySuggestion(query, ctx, choice);
  assert.equal(entered.value, "smiles SUBSTRUCTURE[] 'CC' AND smiles = 'N'");
  const param = queryContext(entered.value, entered.caret, cols);
  assert.equal(param.kind, "parameter");
  assert.deepEqual(querySuggestions(param, cols).map(s => s.label), ["bonds", "hetero", "stereo"]);
  const selected = applyQuerySuggestion(entered.value, param, { label:"hetero", insert:"hetero" });
  assert.equal(selected.value, "smiles SUBSTRUCTURE[hetero] 'CC' AND smiles = 'N'");
});
test("parameter edits replace only the current fragment, omit used flags, and close unfinished brackets", () => {
  const cols = queryColumns([{column:"smiles", type:"SMILES chemical"}]);
  for (const query of ["smiles SUBSTRUCTURE[bonds,he,stereo] 'CC'", "smiles SUBSTRUCTURE[bonds,he"]) {
    const ctx = queryContext(query, query.indexOf(",he") + 3, cols);
    const suggestions = querySuggestions(ctx, cols);
    assert.deepEqual(suggestions.map(s => s.label), ["hetero"]);
    const result = applyQuerySuggestion(query, ctx, suggestions[0]);
    assert.equal(result.value, query.endsWith("he") ? "smiles SUBSTRUCTURE[bonds,hetero]" : "smiles SUBSTRUCTURE[bonds,hetero,stereo] 'CC'");
  }
  const full = "smiles SUBSTRUCTURE[bonds,hetero,stereo,]";
  const ctx = queryContext(full, full.length - 1, cols);
  assert.deepEqual(querySuggestions(ctx, cols), []);
});

test("unfinished parameters never consume brackets from SMILES or subsequent operators", () => {
  const cols = queryColumns([{column:"smiles", type:"SMILES chemical"}]);
  for (const after of [" 'C[N+]' AND smiles = 'N'", " 'CC' AND smiles SUBSTRUCTURE[bonds] 'C'"]) {
    const query = "smiles SUBSTRUCTURE[he" + after;
    const ctx = queryContext(query, query.indexOf("[he") + 3, cols);
    const result = applyQuerySuggestion(query, ctx, {label:"hetero", insert:"hetero"});
    assert.equal(result.value, "smiles SUBSTRUCTURE[hetero]" + after);
  }
});

test("legacy display compaction preserves values, escaped apostrophes and boolean clauses", async () => {
  const { compactStructureQuery } = await server.ssrLoadModule("/src/SearchApp/StructureOptions.tsx");
  const old = "SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false]";
  const query = `smiles ${old} 'C[N+]' OR names = 'x''${old}' AND smiles ${old} 'C'`;
  assert.equal(compactStructureQuery(query), `smiles SUBSTRUCTURE[hetero] 'C[N+]' OR names = 'x''${old}' AND smiles SUBSTRUCTURE[hetero] 'C'`);
  assert.equal(compactStructureQuery(`names = 'unfinished ${old}`), `names = 'unfinished ${old}`);
});

test("chemical alias completion uses membership while manual equality stays valid", () => {
 const q = "familia = 'Apiaceae' AND names = 'skim";
 const ctx = context(q);
 const chosen = querySuggestions(ctx, columns, ["Skimmetine"])[0];
 assert.equal(applyQuerySuggestion(q, ctx, chosen).value, "familia = 'Apiaceae' AND names CONTAINS 'Skimmetine' ");
 assert.deepEqual(labels("names != 'skim", ["Skimmetine"]), []);
 assert.equal(context("names = 'Skimmetine=Other' ").kind, "logical");
});


test("set suggestions use database members, never legacy metadata choices", () => {
  for (const type of ["set chemical", "set[obsolete stale] chemical"]) {
    const cols = queryColumns([{ column: "radicals", type }]);
    const query = "radicals CONTAINS 'O";
    const ctx = queryContext(query, query.length, cols);
    assert.equal(ctx.column.set, true);
    assert.deepEqual(querySuggestions(ctx, cols), []);
    assert.deepEqual(querySuggestions(ctx, cols, ["O'Brien, methyl", "other member"]).map(s => s.label), ["O'Brien, methyl", "other member"]);
    const [choice] = querySuggestions(ctx, cols, ["O'Brien, methyl"]);
    assert.equal(applyQuerySuggestion(query, ctx, choice).value, "radicals CONTAINS 'O''Brien, methyl' ");
    assert.deepEqual(querySuggestions(ctx, cols, null), []);
  }
});
