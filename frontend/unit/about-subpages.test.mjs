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
  assert.deepEqual(ABOUT_ICON_CHOICES.map(({ value }) => value), ["info", "chemicals", "species", "references", "methods", "data"]);
  assert.equal(aboutPageStorageName("methods-2026"), "about-subpage-methods-2026");
});

test("catalog saves notify independent navigation and the hover menu has no mouse gap", async () => {
  const hook = await readFile(new URL("../src/About/useAboutSubpages.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(hook, /dispatchEvent\(new Event\("about-subpages-changed"\)\)/);
  assert.match(hook, /addEventListener\("about-subpages-changed", invalidate\)/);
  assert.match(css, /\.about-nav-menu__items\s*\{[\s\S]*?top: 100%/);
});

test("About editing keeps catalog controls in the side Edit panel and opens every subpage as Markdown", async () => {
  const about = await readFile(new URL("../src/About/About.tsx", import.meta.url), "utf8");
  const aboutPage = await readFile(new URL("../src/About/AboutPage.tsx", import.meta.url), "utf8");
  const manager = await readFile(new URL("../src/About/AboutSubpageManager.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(about, /className=\{`about-layout/);
  assert.match(about, /about-edit-sidebar/);
  assert.match(about, />Edit<\/button>/);
  assert.match(about, /Editing this page as Markdown/);
  assert.match(about, /to="\/about"/);
  assert.match(about, /aria-current=\{page.id === selected\?\.id \? "page" : undefined\}/);
  assert.match(aboutPage, /pageName=\{subpageID \? undefined : "about"\}/);
  assert.match(manager, /Every subpage is Markdown/);
  assert.match(manager, /aria-expanded=\{iconPicker === page.id\}/);
  assert.match(manager, /aria-controls=\{`about-subpage-icons-\$\{page.id\}`\}/);
  assert.match(manager, /id=\{`about-subpage-icons-\$\{page.id\}`\}/);
  assert.match(manager, /about-subpage-manager__icon-picker-wrap/);
  assert.match(manager, /document\.addEventListener\("keydown", closeOnEscape\)/);
  assert.match(manager, /window\.addEventListener\("scroll", placePicker, true\)/);
  assert.match(manager, /window\.innerHeight - paletteRect\.height - margin/);
  assert.match(manager, /aria-label=\{`Open Markdown editor for/);
  assert.match(manager, /aria-label=\{`Remove \$\{/);
  assert.match(manager, /aria-pressed=\{page.icon === icon.value\}/);
  assert.match(manager, /disabled=\{saving\}/);
  assert.match(manager, /disabled=\{saving \|\| draft.length >= 15\}/);
  assert.match(manager, /<AboutIcon icon=\{icon.value\} size=\{18\}/);
  assert.match(manager, /await onSave\(draft\);\s*onEdit\(id\);/);
  assert.match(css, /\.about-subpage-manager__icons\s*\{[\s\S]*?position: fixed/);
  assert.match(css, /\.about-subpages a\s*\{\s*border: 2px solid transparent/);
  assert.match(css, /\.about-subpages a\.is-current\s*\{[\s\S]*?border: 2px solid var\(--color-accent\)/);
});
