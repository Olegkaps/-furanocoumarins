import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());

const { CompareQueriesDisplay } = await server.ssrLoadModule(
  "/src/SearchApp/QueryCompareBar.tsx",
);
const { substructureQuerySmiles } = await server.ssrLoadModule("/src/SearchApp/StructureOptions.tsx");

test("structure previews extract distinct literals across grouped bare, compact and legacy predicates", () => {
  const query = "(smiles SUBSTRUCTURE 'C1CCCCC1' OR other_smiles SUBSTRUCTURE[bonds,hetero] 'O[CH3]') AND smiles SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false] 'C1CCCCC1'";
  assert.deepEqual(substructureQuerySmiles(query), ["C1CCCCC1", "O[CH3]"]);
  assert.deepEqual(substructureQuerySmiles("smiles SUBSTRUCTURE 'C''N'"), ["C'N"]);
  assert.deepEqual(substructureQuerySmiles("(smilesSUBSTRUCTURE'CC' OR smiles SUBSTRUCTURE[bonds]'CO')"), ["CC", "CO"]);
});

test("quoted operator text, ordinary equality and unfinished literals are not depicted", () => {
  assert.deepEqual(substructureQuerySmiles("names = 'fake smiles SUBSTRUCTURE ''CC'' AND smiles SUBSTRUCTURE[bonds] ''CO''' OR smiles = 'CC'"), []);
  assert.deepEqual(substructureQuerySmiles("names = 'unfinished smiles SUBSTRUCTURE ''CC''"), []);
  assert.deepEqual(substructureQuerySmiles("smiles SUBSTRUCTURE 'unfinished"), []);
});

test("comparison primary and extras retain text and controls alongside bounded local previews", () => {
  const primary = "smiles SUBSTRUCTURE 'C1CCCCC1'";
  const extra = "smiles SUBSTRUCTURE[stereo] 'O[CH3]' OR smiles SUBSTRUCTURE 'C1CCCCC1'";
  const html = renderToStaticMarkup(createElement(CompareQueriesDisplay, {
    queries: [primary, extra], colorsByQuery: { [primary]: "#1E3A8A", [extra]: "#B45309" },
    minusQueries: [extra], onToggleHidden() {}, onToggleMinus() {}, onRemove() {},
  }));
  assert.equal((html.match(/class="molecule-preview"/g) ?? []).length, 3);
  assert.match(html, /smiles SUBSTRUCTURE &#x27;C1CCCCC1&#x27;<\/span>/);
  assert.match(html, /background:#1E3A8A/);
  assert.match(html, /title="Use as plus query"/);
  assert.match(html, /title="Minus queries cannot be hidden"/);
  assert.match(html, /title="Remove query"/);

  const oversized = `smiles SUBSTRUCTURE '${"C".repeat(129)}'`;
  const fallback = renderToStaticMarkup(createElement(CompareQueriesDisplay, { queries: [oversized], colorsByQuery: {} }));
  assert.match(fallback, /Preview unavailable/);
  assert.ok(fallback.includes("C".repeat(129)));
  const ordinary = renderToStaticMarkup(createElement(CompareQueriesDisplay, { queries: ["names = 'Psoralen'"], colorsByQuery: {} }));
  assert.doesNotMatch(ordinary, /molecule-preview/);
});

test("compare controls do not allow hidden queries to become minus", () => {
  const html = renderToStaticMarkup(
    createElement(CompareQueriesDisplay, {
      queries: ["primary", "hidden extra"],
      colorsByQuery: { primary: "#1E3A8A", "hidden extra": "#B45309" },
      hiddenQueries: ["hidden extra"],
      minusQueries: [],
      onToggleHidden: () => {},
      onToggleMinus: () => {},
    }),
  );

  assert.match(html, /title="Hidden queries cannot be minus"/);
  assert.match(
    html,
    /aria-label="Use hidden extra as minus"[^>]*disabled=""/,
  );
});

test("compare controls do not allow minus queries to be hidden", () => {
  const html = renderToStaticMarkup(
    createElement(CompareQueriesDisplay, {
      queries: ["primary", "minus extra"],
      colorsByQuery: { primary: "#1E3A8A", "minus extra": "#B45309" },
      hiddenQueries: [],
      minusQueries: ["minus extra"],
      onToggleHidden: () => {},
      onToggleMinus: () => {},
    }),
  );

  assert.match(html, /title="Minus queries cannot be hidden"/);
  assert.match(html, /aria-label="Hide minus extra"[^>]*disabled=""/);
});
