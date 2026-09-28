import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { createServer } from "vite";

// Capture this component's effects and route writes while rendering real React
// markup, so deferred comparison loading can be tested without a browser.
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
  plugins: [{
    name: "navigation-effects",
    resolveId(id) { if (id.startsWith("virtual:navigation-")) return id; },
    load(id) {
      if (id === "virtual:navigation-hooks") return `
        export * from "react";
        export const effects = [];
        export const useEffect = (callback) => effects.push(callback);
      `;
      if (id === "virtual:navigation-router") return `
        export * from "react-router-dom";
        export const writes = [];
        export const useNavigate = () => (to, options) => writes.push({ to, options });
      `;
      if (id === "virtual:navigation-comparison") return `
        let states, params, cursor;
        export const setFixture = (search, values) => { params = new URLSearchParams(search); states = values; cursor = 0; };
        export const useSearchParams = () => [params];
        export const useLocation = () => ({ state: null });
        export const useState = () => [states[cursor++], () => {}];
        export const useRef = () => ({ current: [] });
        export const useMemo = factory => factory();
        export const useEffect = () => {};
      `;
      if (id.endsWith("/useAboutSubpages.ts")) return "export const useAboutSubpages = () => ({ pages: [] });";
    },
    transform(code, id) {
      if (id.endsWith("/ResultTable.tsx")) return code.replace('from "react"', 'from "virtual:navigation-hooks"').replace('from "react-router-dom"', 'from "virtual:navigation-router"');
      if (id.endsWith("/QueryCompareBar.tsx?readiness-test")) return code.replace('from "react"', 'from "virtual:navigation-comparison"').replace('from "react-router-dom"', 'from "virtual:navigation-comparison"');
    },
  }],
});
after(() => server.close());
const { default: ResultTable } = await server.ssrLoadModule("/src/SearchApp/ResultTable.tsx");
const { default: FullNavigation } = await server.ssrLoadModule("/src/FullNavigation/FullNavigation.tsx");
const { default: DataMeta } = await server.ssrLoadModule("/src/SearchApp/DataMeta.tsx");
const { SearchLink } = await server.ssrLoadModule("/src/SearchApp/SearchLine.tsx");
const { effects } = await server.ssrLoadModule("virtual:navigation-hooks");
const { writes } = await server.ssrLoadModule("virtual:navigation-router");
const { useCompareSeries } = await server.ssrLoadModule("/src/SearchApp/QueryCompareBar.tsx?readiness-test");
const { setFixture } = await server.ssrLoadModule("virtual:navigation-comparison");

const metadata = [
  { column: "chemical", name: "Chemical", type: "table_chemical keycolumn", description: "" },
  { column: "smiles", name: "SMILES", type: "SMILES chemical", description: "" },
  { column: "species", name: "Species", type: "table_specie keycolumn clas[0]", description: "" },
  { column: "ref", name: "Reference", type: "table_0 ref[]", description: "" },
];
const row = (chemical, species) => ({ chemical, species, smiles: "CCO", ref: "paper-1" });
const data = [row("one", "first"), row("two", "second")];
const workspace = { countMode: "all", currentChemical: "two", currentSpecie: "second" };
const path = "/table?query=primary&cmp=%5B%22extra%22%5D&cmp_minus=%5B%22minus%22%5D&tag=accepted";
const render = (component, entry = "/table") => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [entry] }, component));
const anchor = html => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];

test("site and table/tree navigation stay in the same tab and retain search options", () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "token" } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => null } });
  let nav;
  try { nav = anchor(render(createElement(FullNavigation))); }
  finally {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage); else delete globalThis.localStorage;
    if (oldSession) Object.defineProperty(globalThis, "sessionStorage", oldSession); else delete globalThis.sessionStorage;
  }
  assert.equal(nav.length, 9);
  for (const link of nav) assert.doesNotMatch(link, /target=|rel=/);
  for (const target of ["/table", "/tree"]) {
    const html = render(createElement(SearchLink, { path: target, text: "Results" }), path);
    assert.match(html, /cmp_minus=/);
    assert.match(html, /tag=accepted/);
    assert.doesNotMatch(html, /target=/);
  }
});

test("metadata links use same-tab local routes but retain external database targets", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://furano.test" } };
  try {
    for (const template of ["/chemical/%s", "https://furano.test/chemical/%s?view=details#name", "https://pubchem.ncbi.nlm.nih.gov/compound/%s"]) {
      const column = new DataMeta("link", "cid", "CID", "", template, "chemical");
      const label = "A long chemical name ".repeat(6);
      const html = render(column.render_link(`${label}: 42`));
      const [link] = anchor(html);
      assert.ok(link);
      assert.doesNotMatch(link, /<button/);
      assert.match(html.slice(html.indexOf("</a>") + 4), /aria-label="Show full value"/);
      if (template.includes("pubchem")) {
        assert.match(link, /target="_blank"/);
        assert.match(link, /rel="noopener noreferrer"/);
        assert.match(link, /meta-link__icon/);
      } else {
        assert.match(link, /href="\/chemical\/42/);
        assert.doesNotMatch(link, /target=|meta-link__icon/);
      }
    }
  } finally { globalThis.window = previousWindow; }
});

test("Back restores both selected panels and count mode on the originating history entry", async () => {
  const router = createMemoryRouter([{ path: "*", element: createElement(ResultTable, { metadata, data }) }], {
    initialEntries: [{ pathname: "/table", search: path.slice(path.indexOf("?")), state: { resultTable: workspace } }],
  });
  await router.navigate("/chemical/two");
  await router.navigate(-1);
  assert.equal(router.state.location.pathname + router.state.location.search, path);
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  assert.match(html, /Chemical \(1\)/);
  assert.match(html, /Species \(1\)/);
  assert.equal(anchor(html).filter(link => /Open (substance|species) page/.test(link)).length, 2);
  for (const link of anchor(html).filter(link => /Open (substance|species) page/.test(link))) assert.doesNotMatch(link, /target=/);
  // The saved mode is restored when selections have been cleared explicitly.
  const cleared = render(createElement(ResultTable, { metadata, data }), { pathname: "/table", state: { resultTable: { ...workspace, currentChemical: "", currentSpecie: "" } } });
  assert.match(cleared, /class="btn-toggle is-active"[^>]*>all<\/button>/);
  router.dispose();
});

test("comparison-only restored selections survive loading; invalid picks clear together after completion", () => {
  const oldWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const renderEffects = props => {
    effects.length = 0; writes.length = 0;
    render(createElement(ResultTable, { metadata, data: [data[0]], ...props }), { pathname: "/table", state: { unrelated: "kept", resultTable: workspace } });
    effects.forEach(effect => effect());
  };
  try {
    renderEffects({ loading: true });
    assert.equal(writes.length, 0);
    renderEffects({ loading: false, compareSeries: [
      { query: "primary", color: "red", response: { metadata, data: [data[0]] } },
      { query: "extra", color: "blue", response: { metadata, data: [data[1]] } },
    ] });
    assert.equal(writes.length, 0);
    renderEffects({ loading: false });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.replace, true);
    assert.deepEqual(writes[0].options.state, { unrelated: "kept", resultTable: { ...workspace, currentChemical: "", currentSpecie: "" } });
  } finally { globalThis.window = oldWindow; }
});

test("a changed comparison list is pending before its loading effect executes", () => {
  const primary = { metadata, data: [data[0]] };
  const extra = { metadata, data: [data[1]] };
  const states = (loadedKey, loading = false) => [
    { primary: "red", extra: "blue" }, { primary, extra },
    { primary: "2026-09-28", extra: "2026-09-28" }, loading, loadedKey,
  ];
  setFixture("query=primary&cmp=%5B%22extra%22%5D", states("primary"));
  assert.equal(useCompareSeries("primary").loading, true);
  setFixture("query=primary&cmp=%5B%22extra%22%5D", states("primary\u0001extra"));
  assert.equal(useCompareSeries("primary").loading, false);
  setFixture("query=primary&cmp=%5B%22extra%22%5D", states("primary\u0001extra", true));
  assert.equal(useCompareSeries("primary").loading, true);
  setFixture("", [{}, {}, {}, false, ""]);
  assert.equal(useCompareSeries("").loading, false);
});
