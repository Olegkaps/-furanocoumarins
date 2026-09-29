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
const { findJsonMatches: find, replaceJsonMatches: replace, nextJsonMatch: next } = await server.ssrLoadModule("/src/Admin/jsonFind.ts");
const options = { matchCase: false, wholeWord: false };

test("find uses literal JSON text, tracks UTF-16 offsets and updates after edits", () => {
  assert.deepEqual(find('😀İ "Name": "name" [.*]', "name", options), [{ start: 5, end: 9 }, { start: 13, end: 17 }]);
  assert.deepEqual(find('[] [.*] [.*]', "[.*]", options), [{ start: 3, end: 7 }, { start: 8, end: 12 }]);
  assert.equal(find('"Name": "name"', "name", { ...options, matchCase: true }).length, 1);
  assert.equal(find("name changed", "name", options).length, 1);
  assert.equal(find("changed", "name", options).length, 0);
  assert.deepEqual(find("anything", "", options), []);
});

test("whole words honor Unicode letters, digits and identifier underscores", () => {
  const text = "id species_id id2 xid idé id 😀id";
  const matches = find(text, "id", { ...options, wholeWord: true });
  assert.deepEqual(matches.map(match => text.slice(match.start, match.end)), ["id", "id", "id"]);
  assert.equal(find("𐐀id id𐐀", "id", { ...options, wholeWord: true }).length, 0);
});

test("replacement is literal, preserves unmatched text and never searches inserted values", () => {
  const text = '{"name":"name","other":true}';
  const matches = find(text, "name", options);
  assert.equal(replace(text, [matches[1]], "$&\\name"), '{"name":"$&\\name","other":true}');
  assert.equal(replace(text, matches, "name-name"), '{"name-name":"name-name","other":true}');
  assert.equal(replace(text, matches, ""), '{"":"","other":true}');
  assert.equal(replace(text, [], "unused"), text);
  assert.equal(replace("aaaa", find("aaaa", "aa", options), "b"), "bb");
});

test("navigation wraps both directions and remains valid for empty/single matches", () => {
  assert.equal(next(3, 2), 0);
  assert.equal(next(3, 0, true), 2);
  assert.equal(next(1, 0), 0);
  assert.equal(next(0, 0, true), 0);
});
