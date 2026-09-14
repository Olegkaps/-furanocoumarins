import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
after(() => server.close());
const { analyzeInBrowser, validateBrowserFindings, validBrowserSettings, defaultModels } = await server.ssrLoadModule("/src/Admin/browserPublicationAnalysis.ts");
const { requestSlot } = await server.ssrLoadModule("/src/Admin/publicationReaderModel.ts");
const document = { title: "Study", pages: [{ number: 3, text: "We detected psoralen in Citrus using HPLC." }], warnings: [], source_url: "https://private.invalid" };
const finding = { chemical: "psoralen", species: "Citrus", chirality: "not reported", methods: ["HPLC"],
  evidence: ["chemical", "species", "methods"].map(field => ({ field, page: 3, quote: document.pages[0].text })) };
const result = { findings: [finding], warnings: [] };
const openai = (content = JSON.stringify(result), extra = {}) => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content }, ...extra }] });
const options = (extra = {}) => ({ provider: "openrouter", model: "openrouter/free", apiKey: "secret-test-key", document, confirmed: true, signal: new AbortController().signal, ...extra });
function transport(t, fn) { t.mock.method(globalThis, "fetch", fn); }

test("provider requests use fixed hosts, isolated credentials and actual JSON formats", async t => {
  for (const provider of ["openrouter", "groq", "gemini"]) {
    let calls = 0;
    transport(t, async (url, init) => {
      calls++;
      assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.method, "POST"); assert.ok(init.signal);
      assert.doesNotMatch(url, /secret-test-key/);
      assert.deepEqual(Object.keys(init.headers).sort(), ["Content-Type", provider === "gemini" ? "x-goog-api-key" : "Authorization"].sort());
      assert.equal(init.headers[provider === "gemini" ? "x-goog-api-key" : "Authorization"], provider === "gemini" ? "secret-test-key" : "Bearer secret-test-key");
      const body = JSON.parse(init.body);
      assert.doesNotMatch(init.body, /private.invalid|secret-test-key|source_url/);
      if (provider === "gemini") {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/custom%2Fmodel:generateContent");
        assert.equal(body.generationConfig.responseMimeType, "application/json");
        assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { title: document.title, pages: document.pages });
        const content = JSON.stringify(result);
        return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "reasoning", thought: true }, { text: content.slice(0, 15), thoughtSignature: "opaque" }, { text: content.slice(15) }] } }] });
      }
      assert.equal(url, provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.deepEqual(JSON.parse(body.messages[1].content), { title: document.title, pages: document.pages });
      return Response.json(openai());
    });
    assert.deepEqual((await analyzeInBrowser(options({ provider, model: provider === "gemini" ? "custom/model" : defaultModels[provider] }))).findings, [finding]);
    assert.equal(calls, 1); t.mock.restoreAll();
  }
});

test("free-only and consent guards prevent any fetch", async t => {
  let calls = 0;
  transport(t, async () => { calls++; return Response.json(openai()); });
  for (const extra of [{ confirmed: false }, { model: "paid/model" }, { model: "https://evil.invalid/:free" }, { apiKey: "key\r\ninjected" }, { apiKey: "" }]) {
    calls = 0;
    await assert.rejects(analyzeInBrowser(options(extra)));
    assert.equal(calls, 0, "invalid settings must be rejected before fetch");
  }
  assert.equal(validBrowserSettings("openrouter", "nvidia/model:free", "key"), true);
  assert.equal(validBrowserSettings("openrouter", "paid/model", "key"), false);
});

test("document byte, numbering, empty and NUL boundaries are checked before sending", async t => {
  let calls = 0;
  transport(t, async () => { calls++; return Response.json(openai(JSON.stringify({ findings: [], warnings: [] }))); });
  for (const pages of [[], [{ number: 201, text: "x" }], [{ number: 1, text: "\0" }], [{ number: 2, text: "x" }, { number: 1, text: "y" }], [{ number: 1, text: " " }], [{ number: 1, text: "é".repeat(80001) }], [{ number: 1, text: "\ud800" }]]) {
    calls = 0;
    await assert.rejects(analyzeInBrowser(options({ document: { ...document, pages } })));
    assert.equal(calls, 0, "invalid documents must be rejected before fetch");
  }
  await analyzeInBrowser(options({ document: { ...document, pages: [{ number: 200, text: "é".repeat(80000) }] } }));
  assert.equal(calls, 1, "a document at the supported boundary must reach fetch");
});

test("field evidence must match exact page quote and contain every reported value", () => {
  assert.deepEqual(validateBrowserFindings(result, document).findings, [finding]);
  for (const change of [{ chemical: "invented" }, { chemical: "not reported" }, { species: "Other" }, { chirality: "achiral" }, { methods: ["MS"] }, { evidence: [] }, { evidence: finding.evidence.map(e => ({ ...e, page: 2 })) }, { evidence: finding.evidence.map(e => ({ ...e, quote: e.quote.toUpperCase() })) }, { evidence: finding.evidence.map(e => ({ ...e, field: "chemical" })) }, { methods: Array(31).fill("HPLC") }, { evidence: Array(101).fill(finding.evidence[0]) }, { confidence: 1 }]) assert.throws(() => validateBrowserFindings({ findings: [{ ...finding, ...change }], warnings: [] }, document));
  assert.throws(() => validateBrowserFindings({ findings: Array(101).fill(finding), warnings: [] }, document));
  assert.equal(validateBrowserFindings({ findings: Array(100).fill({ ...finding, methods: Array(30).fill("HPLC"), evidence: [...finding.evidence, ...Array(97).fill(finding.evidence[0])] }), warnings: [] }, document).findings.length, 100);
});

test("malformed, truncated, refusal and tool responses fail without repair", async t => {
  for (const payload of [openai("```json\n{}\n```"), openai("{"), openai(undefined, { finish_reason: "length" }), openai(undefined, { message: { content: JSON.stringify(result), refusal: "no" } }), openai(undefined, { message: { content: JSON.stringify(result), tool_calls: [] } }), { choices: [] }, { error: { message: "secret-test-key" } }]) {
    let calls = 0; transport(t, async () => { calls++; return Response.json(payload); });
    await assert.rejects(analyzeInBrowser(options()), /invalid|incomplete/); assert.equal(calls, 1); t.mock.restoreAll();
  }
  for (const candidate of [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(result) }] } }, { finishReason: "STOP", content: { parts: [{ functionCall: {} }] } }]) {
    transport(t, async () => Response.json({ candidates: [candidate] }));
    await assert.rejects(analyzeInBrowser(options({ provider: "gemini", model: defaultModels.gemini })), /invalid/); t.mock.restoreAll();
  }
});

test("401, 429 and network/CORS/redirect errors are safe and never retried", async t => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0; transport(t, async () => { calls++; return new Response("secret-test-key", { status }); });
    await assert.rejects(analyzeInBrowser(options()), error => !error.message.includes("secret-test-key") && (status !== 429 || error.message.includes("429")));
    assert.equal(calls, 1); t.mock.restoreAll();
  }
  transport(t, async () => { throw new TypeError("CORS secret-test-key"); });
  await assert.rejects(analyzeInBrowser(options()), error => /network, CORS or redirect/.test(error.message) && !error.message.includes("secret-test-key"));
});

test("response streams are bounded even without content-length", async t => {
  let cancelled = false;
  transport(t, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1048577)); }, cancel() { cancelled = true; } })));
  await assert.rejects(analyzeInBrowser(options()), /invalid/); assert.equal(cancelled, true);
  t.mock.restoreAll(); transport(t, async () => new Response("{}", { headers: { "content-length": "1048577" } }));
  await assert.rejects(analyzeInBrowser(options()), /invalid/);
});

test("timeout bounds a stalled response body and cancellation rejects abort-ignoring fetch", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let streamStarted;
  const started = new Promise(resolve => { streamStarted = resolve; });
  transport(t, async () => new Response(new ReadableStream({ pull() { streamStarted(); return new Promise(() => {}); } })));
  const pending = analyzeInBrowser(options());
  const checked = assert.rejects(pending, /45 seconds/);
  await started; t.mock.timers.tick(45000); await checked;
  t.mock.restoreAll();
  transport(t, () => new Promise(() => {}));
  const slot = requestSlot(), first = slot.begin();
  const stale = analyzeInBrowser(options({ signal: first.signal }));
  slot.begin();
  await assert.rejects(stale, /cancelled/); assert.equal(first.active(), false); slot.cancel();
});
