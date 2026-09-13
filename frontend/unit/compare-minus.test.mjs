import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
after(() => server.close());

const { subtractMinusFromCompareSeries, subtractMinusResponses } =
  await server.ssrLoadModule("/src/SearchApp/compareMinus.ts");

const metadata = [
  {
    column: "chemical_id",
    name: "Chemical ID",
    type: "table_chemical keycolumn",
  },
  {
    column: "classification_id",
    name: "Species ID",
    type: "table_specie keycolumn",
  },
  { column: "referenceid", name: "Reference", type: "table_0 ref[]" },
  { column: "position", name: "Position", type: "table_0" },
];

test("minus responses remove matching scientific rows from plus responses", () => {
  const plus = {
    metadata,
    data: [
      {
        chemical_id: "chem-1",
        classification_id: "sp-1",
        referenceid: "paper-1",
        position: "root",
      },
      {
        chemical_id: "chem-2",
        classification_id: "sp-2",
        referenceid: "paper-2",
        position: "leaf",
      },
    ],
  };
  const minus = {
    metadata,
    data: [
      {
        chemical_id: "chem-1",
        classification_id: "sp-1",
        referenceid: "paper-1",
        position: "different display-only value",
      },
    ],
  };

  const result = subtractMinusResponses(plus, [minus]);

  assert.deepEqual(result.data.map((row) => row.chemical_id), ["chem-2"]);
  assert.deepEqual(plus.data.map((row) => row.chemical_id), [
    "chem-1",
    "chem-2",
  ]);
});

test("hidden plus series are omitted while visible minus series subtract", () => {
  const plus = {
    metadata,
    data: [
      {
        chemical_id: "chem-1",
        classification_id: "sp-1",
        referenceid: "paper-1",
        position: "root",
      },
      {
        chemical_id: "chem-2",
        classification_id: "sp-2",
        referenceid: "paper-2",
        position: "leaf",
      },
    ],
  };
  const minus = {
    metadata,
    data: [
      {
        chemical_id: "chem-1",
        classification_id: "sp-1",
        referenceid: "paper-1",
        position: "root",
      },
    ],
  };

  const { minusResponses, plusSeries } = subtractMinusFromCompareSeries(
    [
      {
        query: "minus",
        mode: "minus",
        color: "#B45309",
        response: minus,
        fetchedAt: "2026-09-12T00:01:00.000Z",
      },
      {
        query: "hidden plus",
        mode: "plus",
        color: "#1E3A8A",
        response: plus,
        fetchedAt: "2026-09-12T00:00:00.000Z",
      },
      {
        query: "visible plus",
        mode: "plus",
        color: "#166534",
        response: plus,
        fetchedAt: "2026-09-12T00:02:00.000Z",
      },
    ],
    ["hidden plus"],
  );

  assert.equal(minusResponses.length, 1);
  assert.deepEqual(plusSeries.map((s) => s.query), ["visible plus"]);
  assert.deepEqual(plusSeries[0].response.data.map((row) => row.chemical_id), [
    "chem-2",
  ]);
});
