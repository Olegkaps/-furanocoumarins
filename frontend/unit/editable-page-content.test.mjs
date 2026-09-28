import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
  esbuild: { jsx: "automatic" },
});
after(() => server.close());
const { ReadOnlyPageContent } = await server.ssrLoadModule("/src/features/editable-page/EditablePageContent.tsx");

const render = (props) => renderToStaticMarkup(createElement(ReadOnlyPageContent, props));

test("empty editable-page content is omitted while errors and real markdown remain visible", () => {
  assert.equal(render({ content: "", error: null }), "");
  assert.match(render({ content: "", error: "Could not load page." }), /Could not load page\./);
  assert.match(render({ content: "## Page details", error: null }), /<h2>Page details<\/h2>/);
});
