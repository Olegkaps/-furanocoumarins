import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { classificationRanks, classificationSelection, classificationTyped, withClassificationColumn } =
  await server.ssrLoadModule("/src/SearchApp/classificationAutocomplete.ts");
const pair = [
  { column: "epithet", type: "search clas[0] specie" },
  { column: "taxon_parent", type: "search clas[01] specie" },
];
test("classification uses ranks and matching tags, respecting search and ambiguity", () => {
  assert.equal(withClassificationColumn(pair).at(-1).column, "__classification_name");
  assert.equal(withClassificationColumn(pair).at(-1).show_name, "epithet + taxon_parent");
  assert.equal(withClassificationColumn(pair, "Configured parent + child").at(-1).show_name, "Configured parent + child");
  assert.deepEqual(classificationRanks([pair[0]]), []);
  assert.deepEqual(classificationRanks([pair[0], { ...pair[1], type: "clas[1] specie" }]), []);
  assert.deepEqual(classificationRanks([pair[0], { ...pair[1], type: "search clas[1][other]" }]), []);
  assert.deepEqual(classificationRanks([...pair, { ...pair[0], column: "duplicate" }]), []);
  const other = pair.map(c => ({ ...c, column: c.column + "_other", type: c.type.replace(/clas\[\d+\]/, "$&[other]") }));
  assert.equal(classificationRanks([...pair, ...other]).length, 2);
});
test("selected pair preserves raw exact values, quoting and metadata set semantics", () => {
  const columns = [pair[0], { ...pair[1], type: "search clas[1] set specie" }];
  assert.equal(classificationSelection([
    { column: "epithet", type: "wrong", value: "o'brienii" },
    { column: "taxon_parent", type: "wrong", value: " O'Brien " },
  ], columns), "(epithet = 'o''brienii' AND taxon_parent CONTAINS ' O''Brien ')");
  assert.equal(classificationSelection([{ column: "hidden", value: "x" }], pair), "");
  assert.equal(classificationSelection([{ column: "epithet", value: "x" }], pair), "");
  assert.equal(classificationSelection([{ column: "taxon_parent", value: "x" }, { column: "taxon_parent", value: "y" }], pair), "");
});
test("typed full names and infra ranks become existing physical expressions", () => {
  const query = classificationTyped("Angelica archangelica subsp. litoralis", pair);
  assert.ok(query.includes("(taxon_parent = 'Angelica' AND epithet = 'archangelica subsp. litoralis')"));
  assert.ok(query.includes("epithet = 'Angelica archangelica subsp. litoralis'"));
  assert.ok(!query.includes("__classification_name"));
});
