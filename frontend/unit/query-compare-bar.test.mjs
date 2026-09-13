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
