import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { ClassificationAutocompleteNote } = await server.ssrLoadModule("/src/SearchApp/ClassificationAutocompleteNote.tsx");
const { PublicConfigContext } = await server.ssrLoadModule("/src/shared/publicConfig.ts");

test("guided search note renders only deployment-configured copy", () => {
  const configured = renderToStaticMarkup(createElement(PublicConfigContext.Provider,
    { value: { classification_autocomplete_hint: "Configured current-rank note" } },
    createElement(ClassificationAutocompleteNote, { id: "classification-note" })));
  assert.match(configured, /Configured current-rank note/);
  const unavailable = renderToStaticMarkup(createElement(ClassificationAutocompleteNote, { id: "classification-note" }));
  assert.equal(unavailable, "");
  assert.doesNotMatch(configured, /Generated from the genus and species columns/);
});
