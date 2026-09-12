import test from "node:test";
import assert from "node:assert/strict";
import { selectTreeTaxonomy } from "../src/SearchApp/treeTaxonomy.mjs";

const column = (name, type) => ({ column: name, name, type });
const names = result => result.columns.map(item => item.column);

test("tree ranks run broadest to narrowest independently of metadata token order", () => {
  const metadata = [
    column("species", "search table_specie clas[0]"),
    column("tribe", "table_2 search clas[3]"),
    column("family", "clas[10]"),
    column("genus", "table_specie clas[1] search"),
    column("subfamily", "default[family] clas[6]"),
  ];
  const before = structuredClone(metadata);
  assert.deepEqual(names(selectTreeTaxonomy(metadata)), ["family", "subfamily", "tribe", "genus", "species"]);
  assert.deepEqual(names(selectTreeTaxonomy([...metadata].reverse())), ["family", "subfamily", "tribe", "genus", "species"]);
  assert.deepEqual(metadata, before, "must not reorder shared response metadata");
});

test("selected taxonomy overrides exactly its rank regardless of input adjacency", () => {
  const metadata = [
    column("accepted_genus", "search clas[1][accepted]"),
    column("original_species", "clas[0]"),
    column("pimenov_tribe", "clas[3][pimenov]"),
    column("family", "clas[7]"),
    column("original_genus", "clas[1]"),
    column("accepted_species", "clas[0][accepted]"),
  ];
  for (const input of [metadata, [...metadata].reverse()]) {
    assert.deepEqual(names(selectTreeTaxonomy(input, "accepted")), ["family", "accepted_genus", "accepted_species"]);
    assert.deepEqual(names(selectTreeTaxonomy(input)), ["family", "original_genus", "original_species"]);
    assert.deepEqual(names(selectTreeTaxonomy(input, "pimenov")), ["family", "pimenov_tribe", "original_genus", "original_species"]);
  }
  assert.deepEqual(selectTreeTaxonomy(metadata).tags, ["accepted", "original", "pimenov"]);
});

test("missing source falls back to original and ignores unrelated or invalid ranks", () => {
  const metadata = [
    column("species", "clas[0][original]"),
    column("bad", "clas[not-a-number]"),
    column("negative", "clas[-1]"),
    column("decimal", "clas[1.5]"),
    column("overflow", "clas[9007199254740992]"),
    column("not_taxonomy", "link[https://example.test/clas[8]/%s]"),
    column("chemical", "SMILES search"),
  ];
  assert.deepEqual(names(selectTreeTaxonomy(metadata, "missing")), ["species"]);
  assert.deepEqual(selectTreeTaxonomy([], "missing"), { columns: [], tags: ["missing", "original"] });
});
