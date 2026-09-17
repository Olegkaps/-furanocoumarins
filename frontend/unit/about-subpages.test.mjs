import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { ABOUT_ICON_CHOICES, aboutPageStorageName } = await server.ssrLoadModule("/src/About/aboutSubpageTypes.ts");

test("About subpages have a bounded icon choice and isolated markdown storage names", () => {
  assert.equal(ABOUT_ICON_CHOICES.length, 6);
  assert.deepEqual(ABOUT_ICON_CHOICES.map(({ value }) => value), ["info", "book", "document", "flask", "leaf", "table"]);
  assert.equal(aboutPageStorageName("methods-2026"), "about-subpage-methods-2026");
});

test("catalog saves notify independent navigation and the hover menu has no mouse gap", async () => {
  const hook = await readFile(new URL("../src/About/useAboutSubpages.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(hook, /dispatchEvent\(new Event\("about-subpages-changed"\)\)/);
  assert.match(hook, /addEventListener\("about-subpages-changed", invalidate\)/);
  assert.match(css, /\.about-nav-menu__items\s*\{[\s\S]*?top: 100%/);
});
