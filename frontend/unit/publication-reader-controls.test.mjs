import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Exercise the component's event handlers and effects without a browser or DOM.
const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
  plugins: [{ name: "reader-controls-fixture", enforce: "pre", transform(code, id) {
    if (id.endsWith("/Admin/PublicationReader.tsx")) return code.replaceAll('from "react"', 'from "virtual:reader-hooks"');
  }, resolveId(id, importer) {
    if (id === "virtual:reader-hooks") return "\0fixture:react";
    if (importer?.endsWith("/Admin/PublicationReader.tsx") && (id === "react" || id === "./utils")) return `\0fixture:${id}`;
  }, load(id) {
    if (id === "\0fixture:./utils") return `export const api = { get: (...args) => globalThis.__readerAPI.get(...args), post: (...args) => globalThis.__readerAPI.post(...args) }; export const getToken = () => 'application-token';`;
    if (id === "\0fixture:react") return `export const useState = (...args) => globalThis.__readerHooks.useState(...args); export const useEffect = (...args) => globalThis.__readerHooks.useEffect(...args); export const useRef = (...args) => globalThis.__readerHooks.useRef(...args);`;
  } }],
});
after(() => server.close());
const { default: Reader } = await server.ssrLoadModule("/src/Admin/PublicationReader.tsx");
const document = { title: "Paper", pages: [{ number: 1, text: "Study text" }], warnings: [] };
function fixture(t, api = {}) {
  let cells = [], cursor = 0, effects = [], tree;
  const hooks = {
    useState(initial) { const at = cursor++; cells[at] ??= { value: initial }; return [cells[at].value, next => { cells[at].value = typeof next === "function" ? next(cells[at].value) : next; }]; },
    useRef(initial) { const at = cursor++; cells[at] ??= { value: { current: initial } }; return cells[at].value; },
    useEffect(effect, deps) { const at = cursor++; if (!cells[at] || deps.some((dep, i) => dep !== cells[at].deps[i])) { const previous = cells[at]; cells[at] = { deps }; effects.push(() => { previous?.cleanup?.(); cells[at].cleanup = effect(); }); } },
  };
  globalThis.__readerHooks = hooks;
  globalThis.__readerAPI = { get: async () => ({ data: { configured: false, provider: "yandex", warnings: ["Analysis requires configured Yandex"] } }), post: async () => ({ data: document }), ...api };
  const render = () => { cursor = 0; tree = Reader(); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; };
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const words = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(words).join("") : words(node?.props?.children ?? "");
  const find = predicate => { const node = nodes(tree).find(predicate); assert.ok(node, "control exists"); return node; };
  const button = title => find(node => node.type === "button" && words(node) === title);
  const input = type => find(node => node.type === "input" && node.props.type === type);
  const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const unmount = () => { cells.forEach(cell => cell.cleanup?.()); cells = []; effects = []; };
  t.after(() => { unmount(); delete globalThis.__readerHooks; delete globalThis.__readerAPI; });
  render();
  return { render, settle, button, input, find, words: () => words(tree), unmount,
    provider(value) { find(node => node.type === "select").props.onChange({ target: { value } }); render(); },
    async ready() { await settle(); input("file").props.onChange({ target: { files: [new File(["text"], "paper.txt")] } }); render();
      find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
      input("password").props.onChange({ target: { value: "provider-key" } }); render(); input("checkbox").props.onChange({ target: { checked: true } }); render(); },
  };
}

test("browser mode works with Alice disabled, requires consent, revalidates admin and isolates key", async t => {
  const appCalls = []; let fetchCalls = 0;
  const ui = fixture(t, { get: async (...args) => { appCalls.push(args); return { data: { configured: false, provider: "yandex", warnings: ["Analysis requires configured Yandex"] } }; }, post: async (...args) => { appCalls.push(args); return { data: document }; } });
  t.mock.method(globalThis, "fetch", async () => { fetchCalls++; return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"findings":[],"warnings":[]}' } }] }); });
  assert.equal(ui.button("Analyze").props.disabled, true);
  await ui.ready();
  assert.doesNotMatch(ui.words(), /Analysis requires configured Yandex|Server Alice:/);
  assert.equal(ui.button("Analyze").props.disabled, false);
  ui.input("checkbox").props.onChange({ target: { checked: false } }); ui.render(); assert.equal(ui.button("Analyze").props.disabled, true);
  ui.input("checkbox").props.onChange({ target: { checked: true } }); ui.render();
  ui.button("Analyze").props.onClick(); await ui.settle();
  assert.equal(fetchCalls, 1); assert.equal(appCalls.filter(([path]) => path.endsWith("/status")).length, 2);
  assert.ok(appCalls.every(call => !JSON.stringify(call).includes("provider-key")));
});

test("denied admin revalidation prevents provider request", async t => {
  let checks = 0;
  const ui = fixture(t, { get: async () => { if (++checks > 1) throw new Error("Access denied"); return { data: { configured: false, provider: "" } }; } });
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(); });
  await ui.ready(); ui.button("Analyze").props.onClick(); await ui.settle();
  assert.equal(calls, 0); assert.match(ui.words(), /Access denied/);
});

test("provider changes clear secrets and consent, abort work, and ignore late verification", async t => {
  let checks = 0, complete, requestSignal;
  const ui = fixture(t, { get: async (_path, config) => {
    if (++checks === 1) return { data: { configured: false, provider: "" } };
    requestSignal = config.signal; return new Promise(resolve => { complete = resolve; });
  } });
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(); });
  await ui.ready(); ui.button("Analyze").props.onClick(); ui.render();
  ui.provider("gemini");
  assert.equal(ui.input("password").props.value, ""); assert.equal(ui.input("checkbox").props.checked, false);
  assert.equal(requestSignal.aborted, true);
  assert.ok(ui.find(node => node.type === "input" && node.props.value === "gemini-2.5-flash"));
  complete({ data: { configured: true, provider: "yandex" } }); await ui.settle(); assert.equal(calls, 0);
  ui.provider("server"); assert.equal(ui.button("Analyze").props.disabled, true);
  ui.provider("openrouter"); assert.equal(ui.input("password").props.value, "");
});

test("unmount aborts pending provider request and releases component key state", async t => {
  const ui = fixture(t); let requestSignal;
  t.mock.method(globalThis, "fetch", async (_url, config) => { requestSignal = config.signal; return new Promise(() => {}); });
  await ui.ready(); ui.button("Analyze").props.onClick(); await ui.settle(); assert.equal(requestSignal.aborted, false);
  ui.unmount(); assert.equal(requestSignal.aborted, true);
  await ui.settle(); assert.equal(ui.input("password").props.value, "");
});

test("local extraction import makes no provider request and replaces document with validated pairs", async t => {
  const ui = fixture(t);
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected provider call"); });
  await ui.settle();
  const review = { document, analysis: { findings: [{ chemical: "Candidate", species: "Species", methods: [], chirality: "Unknown", evidence: [] }], warnings: [] } };
  const input = ui.find(node => node.type === "input" && node.props.accept === ".json,application/json");
  input.props.onChange({ target: { files: [new File([JSON.stringify(review)], "extraction.json")], value: "extraction.json" } });
  await ui.settle();
  assert.match(ui.words(), /No model request was made/);
  const view = ui.find(node => node.props?.publication?.title === "Paper");
  assert.equal(view.props.analysis.findings[0].chemical, "Candidate");
  assert.equal(calls, 0);
  input.props.onChange({ target: { files: [new File(["{}"], "bad.json")], value: "bad.json" } });
  await ui.settle();
  assert.match(ui.words(), /Invalid publication/);
  assert.equal(ui.find(node => node.props?.publication?.title === "Paper").props.analysis.findings.length, 1);
});
