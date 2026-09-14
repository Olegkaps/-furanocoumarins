import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom", esbuild: { jsx: "automatic" },
});
after(() => server.close());
const model = await server.ssrLoadModule("/src/Admin/publicationReaderModel.ts");
const view = await server.ssrLoadModule("/src/Admin/PublicationReaderView.tsx");
const publication = { title: "Publication", pages: [{ number: 3, text: "alpha beta alpha" }, { number: 8, text: "alpha" }], warnings: [] };
const finding = { chemical: "Candidate", species: "Species", methods: [], chirality: "", evidence: [{ page: 3, quote: "alpha", field: "chemical" }] };
const render = (document, findings = null) => renderToStaticMarkup(createElement(view.PublicationReaderView, { publication: document, analysis: findings === null ? null : model.readAnalysis({ findings, warnings: [] }) }));

test("direct API contracts preserve page identity, warnings, optional source and evidence field", () => {
  assert.deepEqual(model.readDocument({ ...publication, source_url: "https://example.test", warnings: ["Partial text"] }), { ...publication, source_url: "https://example.test", warnings: ["Partial text"] });
  const analysis = model.readAnalysis({ findings: [finding], warnings: [] });
  assert.equal(analysis.findings[0].chirality, "Unknown");
  assert.equal(analysis.findings[0].evidence[0].field, "chemical");
  assert.deepEqual(model.readStatus({ configured: false, provider: "" }), { configured: false, provider: "" });
  assert.deepEqual(model.readStatus({ configured: false, provider: "yandex", warnings: ["API required"], limits: { source_bytes: 8388608 } }), { configured: false, provider: "yandex", warnings: ["API required"], sourceBytes: 8388608 });
});

test("malformed payloads fail instead of becoming empty successful extraction", () => {
  for (const value of [null, {}, { document: publication }, { ...publication, pages: [{ number: 0, text: "x" }] }, { ...publication, pages: [publication.pages[0], publication.pages[0]] }]) assert.throws(() => model.readDocument(value));
  for (const value of [{}, { findings: null, warnings: [] }, { findings: [{ ...finding, methods: "HPLC" }], warnings: [] }, { findings: [{ ...finding, evidence: [{ page: 1, quote: 2 }] }], warnings: [] }]) assert.throws(() => model.readAnalysis(value));
  assert.throws(() => model.readStatus({ configured: "false", provider: "Alice" }));
});

test("evidence is exact, page-qualified, repeated and never fuzzy or cross-page", () => {
  assert.deepEqual(model.evidenceMatches(publication, { page: 3, quote: "alpha" }), [0, 11]);
  assert.deepEqual(model.evidenceMatches(publication, { page: 8, quote: "alpha" }), [0]);
  for (const evidence of [{ page: 1, quote: "alpha" }, { page: 3, quote: "Alpha" }, { page: 3, quote: " " }, { page: 3, quote: "" }, { page: 3, quote: "alpha  beta" }]) assert.deepEqual(model.evidenceMatches(publication, evidence), []);
  assert.deepEqual(model.evidenceMatches({ ...publication, pages: [{ number: 1, text: "aaa" }] }, { page: 1, quote: "aa" }), [0, 1]);
});

test("overlapping highlights preserve every character and every jump start", () => {
  const parts = model.highlightParts("a😀bc\nxyz", [{ start: 1, end: 5 }, { start: 3, end: 8 }]);
  assert.equal(parts.map(part => part.text).join(""), "a😀bc\nxyz");
  assert.ok(parts.find(part => part.start === 1)?.highlighted);
  assert.ok(parts.find(part => part.start === 3)?.highlighted);
  assert.equal(parts[0].highlighted, false);
});

test("common quotations and duplicate evidence have bounded shared matches", () => {
  const document = { ...publication, pages: [{ number: 1, text: "a".repeat(160000) }] };
  const evidence = { page: 1, quote: "a" };
  assert.equal(model.evidenceMatches(document, evidence).length, 20);
  const index = model.buildEvidenceIndex(document, Array.from({ length: 100 }, () => ({ ...finding, evidence: Array(100).fill(evidence) })));
  assert.equal(index.matches.size, 1);
  assert.equal(index.ranges.get(1).length, 20);
  assert.equal(index.matches.get(model.evidenceKey(evidence)).omitted, true);
  assert.match(render(document, [{ ...finding, evidence: [evidence] }]), /More matches omitted/);
});

test("document budget bounds unique evidence and sweep preserves overlapping source", () => {
  const document = { ...publication, pages: [{ number: 1, text: "a".repeat(160000) }] };
  const evidence = Array.from({ length: 1000 }, (_, i) => ({ page: 1, quote: "a".repeat(i + 1) }));
  const index = model.buildEvidenceIndex(document, [{ ...finding, evidence }]);
  const ranges = index.ranges.get(1);
  assert.equal(ranges.length, 1000);
  assert.deepEqual(index.matches.get(model.evidenceKey(evidence.at(-1))), { starts: [], omitted: true, unsearched: true });
  const parts = model.highlightParts(document.pages[0].text, ranges);
  assert.ok(parts.length <= 2001);
  assert.equal(parts.map(part => part.text).join(""), document.pages[0].text);
  for (const range of ranges) assert.ok(parts.find(part => part.start === range.start)?.highlighted);
});

test("large analyses paginate candidates and evidence to bound initial DOM", () => {
  const evidence = Array.from({ length: 100 }, () => ({ page: 3, quote: "alpha" }));
  const html = render(publication, Array.from({ length: 100 }, () => ({ ...finding, evidence })));
  assert.equal((html.match(/class="publication-reader__finding"/g) ?? []).length, 10);
  assert.equal((html.match(/class="publication-reader__evidence"/g) ?? []).length, 50);
  assert.match(html, /aria-label="Next Candidates"/);
  assert.match(html, /aria-label="Next Evidence"/);
  assert.ok((html.match(/<button/g) ?? []).length < 150);
});

test("renderer escapes source and model HTML, exposes unknown chirality and repeated passage targets", () => {
  const html = render({ ...publication, title: "<script>title</script>", pages: [...publication.pages, { number: 9, text: "<img src=x onerror=alert(1)>" }] }, [{ ...finding, species: "<iframe>" }]);
  assert.match(html, /&lt;script&gt;title/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;iframe&gt;/);
  assert.doesNotMatch(html, /<script|<iframe|<img/);
  assert.match(html, /Not curated records/);
  assert.match(html, /<dd>Unknown<\/dd>/);
  assert.match(html, /<strong>chemical<\/strong>/);
  assert.match(html, /id="publication-p3-at0" tabindex="-1"/);
  assert.match(html, /id="publication-p3-at11" tabindex="-1"/);
  assert.doesNotMatch(html, /id="publication-p8-at0"/);
  assert.match(html, /Page 3, match 2/);
});

test("empty states and unverifiable evidence remain explicit without jump buttons", () => {
  assert.match(render(publication), /No analysis yet/);
  assert.match(render(publication, []), /No candidates returned/);
  assert.match(render({ ...publication, pages: [] }), /No pages returned/);
  assert.match(render({ ...publication, pages: [{ number: 1, text: "" }] }), /No extracted text/);
  const html = render(publication, [{ ...finding, evidence: [{ page: 99, quote: "alpha" }] }]);
  assert.match(html, /exact quote not found/);
  assert.match(html, /<strong>Evidence<\/strong>/);
  assert.doesNotMatch(html, /<mark|>Page 99<\/button>/);
});

test("review imports preserve exact section evidence and reject ambiguous or oversized bundles", () => {
  const bundle = { title: "Paper", warnings: [], sections: [{ id: "plants", text: "Species yielded Candidate." }],
    findings: [{ ...finding, evidence: [{ section_id: "plants", field: "species", quote: "Species" }],
      mentions: [{ section_id: "plants", field: "chemical", quote: "Candidate" }], association_note: "Across passages" }] };
  const review = model.readReviewBundle(bundle);
  assert.equal(review.analysis.findings[0].evidence[0].page, 1);
  assert.equal(review.analysis.findings[0].mentions[0].quote, "Candidate");
  assert.equal(review.analysis.findings[0].association_note, "Across passages");
  assert.match(review.publication.warnings[0], /logical page/);
  assert.deepEqual(model.readReviewBundle({ document: review.publication, analysis: review.analysis }), review);
  assert.throws(() => model.readReviewBundle({ ...bundle, sections: [...bundle.sections, ...bundle.sections] }), /Duplicate/);
  assert.throws(() => model.readReviewBundle({ ...bundle, sections: [{ id: "elsewhere", text: "text" }] }), /unknown/);
  assert.throws(() => model.readReviewBundle({ ...bundle, findings: Array(501).fill(bundle.findings[0]) }), /limits/);
});

test("selected highlights preserve source, stay inside cited context and keep active color", () => {
  const document = { title: "Paper", warnings: [], pages: [{ number: 1, text: "Species elsewhere. Species yielded Candidate." }] };
  const fact = { ...finding, evidence: [{ page: 1, field: "species", quote: "Species yielded Candidate." }, { page: 1, field: "chemical", quote: "Candidate" }] };
  const ranges = model.findingHighlights(document, fact).get(1);
  assert.equal(ranges.filter(range => range.kind === "species").length, 1);
  assert.equal(ranges.find(range => range.kind === "species").start, 19);
  const parts = model.coloredHighlightParts(document.pages[0].text, ranges);
  assert.equal(parts.map(part => part.text).join(""), document.pages[0].text);
  assert.equal(parts[0].kind, undefined);
  const active = model.coloredHighlightParts(document.pages[0].text, model.findingHighlights(document, fact, fact.evidence[0]).get(1));
  assert.ok(active.filter(part => part.start >= 19).every(part => part.kind === "active"));
  assert.equal(model.findingHighlights(document, undefined).size, 0);
  const missing = model.findingHighlights(document, { ...fact, evidence: [{ page: 1, field: "species", quote: "Species absent" }] });
  assert.equal(missing.size, 0);
});

test("evidence jump scrolls and focuses the specific passage without a second scroll", () => {
  const calls = [];
  const previous = globalThis.document;
  globalThis.document = { getElementById(id) { calls.push(id); return { scrollIntoView(options) { calls.push(options); }, focus(options) { calls.push(options); } }; } };
  try {
    model.jumpToPassage("publication-p3-at11");
    assert.deepEqual(calls, ["publication-p3-at11", { block: "center", behavior: "auto" }, { preventScroll: true }]);
    globalThis.document.getElementById = () => null;
    assert.doesNotThrow(() => model.jumpToPassage("missing"));
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test("replacement, cancellation and cleanup reject stale responses even when transport ignores abort", async () => {
  const slot = model.requestSlot();
  const first = slot.begin();
  let finish;
  let displayed = "current";
  const lateResponse = new Promise(resolve => { finish = resolve; }).then(() => { if (first.active()) displayed = "stale"; });
  const second = slot.begin();
  assert.equal(first.signal.aborted, true);
  finish(); await lateResponse;
  assert.equal(displayed, "current");
  assert.equal(second.active(), true);
  slot.cancel();
  assert.equal(second.active(), false);
  assert.equal(second.signal.aborted, true);
  const third = slot.begin();
  assert.equal(third.active(), true);
  slot.cancel();
  assert.equal(third.active(), false);
});
