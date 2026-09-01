import test from "node:test";
import assert from "node:assert/strict";

import {
  resultGroupIdentity,
  resultRowIdentity,
} from "../src/SearchApp/resultRowIdentity.mjs";

test("scientific group identity preserves tuple boundaries and array order", () => {
  const scalarLeft = resultGroupIdentity([["chemical", "ab"]], [["species", "c"]]);
  const scalarRight = resultGroupIdentity([["chemical", "a"]], [["species", "bc"]]);
  assert.notEqual(scalarLeft, scalarRight);

  const arrayLeft = resultGroupIdentity([["aliases", ["ab", "c"]]], []);
  const arrayRight = resultGroupIdentity([["aliases", ["a", "bc"]]], []);
  const reordered = resultGroupIdentity([["aliases", ["c", "ab"]]], []);
  assert.notEqual(arrayLeft, arrayRight);
  assert.notEqual(arrayLeft, reordered);
  assert.equal(
    resultGroupIdentity([["z", "last"], ["a", "first"]], []),
    resultGroupIdentity([["a", "first"], ["z", "last"]], []),
  );
});

test("reference-backed row identity keeps distinct species and chemicals", () => {
  const values = new Map([
    ["note", "same observation values"],
    ["references", "ref-a, ref-b"],
  ]);

  const ruta = resultRowIdentity("Ruta graveolens", "Bergapten", values, ["references"]);
  const citrus = resultRowIdentity("Citrus limon", "Bergapten", values, ["references"]);
  const xanthotoxin = resultRowIdentity("Ruta graveolens", "Xanthotoxin", values, ["references"]);

  assert.notEqual(ruta, citrus);
  assert.notEqual(ruta, xanthotoxin);
});

test("identical compare-series copies have one stable reference identity", () => {
  const first = new Map([
    ["references_b", "ref-b"],
    ["references_a", "ref-a"],
    ["note", "first series"],
  ]);
  const repeated = new Map([
    ["note", "second series copy"],
    ["references_a", "ref-a"],
    ["references_b", "ref-b"],
  ]);

  assert.equal(
    resultRowIdentity("Ruta graveolens", "Bergapten", first, ["references_b", "references_a"]),
    resultRowIdentity("Ruta graveolens", "Bergapten", repeated, ["references_a", "references_b"]),
  );
});

test("unreferenced row identity is complete, order-stable, and null-safe", () => {
  const first = new Map([
    ["nullable", null],
    ["value", "a=b\\u0000c"],
  ]);
  const reordered = new Map([
    ["value", "a=b\\u0000c"],
    ["nullable", null],
  ]);
  const changed = new Map([
    ["nullable", null],
    ["value", "different"],
  ]);

  const firstKey = resultRowIdentity(null, undefined, first, ["references"]);
  assert.equal(firstKey, resultRowIdentity(null, undefined, reordered, ["references"]));
  assert.notEqual(firstKey, resultRowIdentity(null, undefined, changed, ["references"]));
});
