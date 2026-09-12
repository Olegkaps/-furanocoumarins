import test from "node:test";
import assert from "node:assert/strict";
import { compareMetadataResultTypes } from "../src/shared/metadataType.mjs";

test("result positions sort numerically regardless of preceding modifiers", () => {
  const types = ["table_10", "search table_2", "SMILES table_0", "table_"];
  assert.deepEqual(types.sort(compareMetadataResultTypes), ["SMILES table_0", "search table_2", "table_10", "table_"]);
});

test("unpositioned metadata retains legacy ordering and ignores modifier contents", () => {
  assert.equal(compareMetadataResultTypes("table_", "table_"), 0);
  assert.ok(compareMetadataResultTypes("table_2", "link[https://example.test/table_0/%s] table_") < 0);
  assert.ok(compareMetadataResultTypes("search table_", "table_") < 0);
});
