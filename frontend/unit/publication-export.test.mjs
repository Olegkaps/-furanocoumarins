import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
after(() => server.close());
const m = await server.ssrLoadModule("/src/Admin/publicationExportModel.ts");
const columns = [{ name: "referenceid", reference: true, data_type: "text" }, { name: "pubchemcid", data_type: "text" }, { name: "lsid_original", data_type: "text" }, { name: "empty", data_type: "set" }];
const metadata = { published: true, version: 2, document: { schema_version: 2, importable: true, sheets: [{ name: "main", source_sheets: ["Observations"], columns }] } };
const response = (request, data) => ({ metadata: request.projection.map(column => ({ column })), data });

test("published physical main columns retain declared order including empty and reference columns", () => {
  const result = m.mainColumns(metadata);
  assert.deepEqual(result.columns.map(c => c.name), columns.map(c => c.name));
  assert.equal(result.columns[1].lookup, "chemical");
  assert.equal(result.columns[2].lookup, "species");
  for (const bad of [null, {}, { ...metadata, published: false }, { ...metadata, document: { ...metadata.document, importable: false } }, { ...metadata, document: { ...metadata.document, sheets: [{ ...metadata.document.sheets[0], columns: [columns[0], columns[0]] }] } }]) assert.throws(() => m.mainColumns(bad));
});
test("lookups are field scoped, escaped, bounded and never reference constrained", () => {
  assert.equal(m.lookupRequest("chemical", "O'Brien").query, "names LIKE '%O''Brien%'");
  assert.deepEqual(m.lookupRequest("chemical", "X").projection, ["pubchemcid", "names"]);
  assert.equal(m.lookupRequest("species", "Ducrosia anethifolia").query, "genus_original = 'Ducrosia' AND species_original LIKE 'anethifolia%'");
  assert.equal(m.lookupRequest("species", "Ducrosia").query, "genus_original = 'Ducrosia'");
  for (const term of ["", " ", "a".repeat(201)]) assert.equal(m.lookupRequest("chemical", term), null);
  assert.equal(m.lookupRequest("species", "Ducrosia anethifolia author"), null);
});
test("metadata resolves renamed chemical keys and name projection without a static catalog", () => {
  const doc = { ...metadata, document: { ...metadata.document, sheets: [{ name: "main", source_sheets: ["Main"], columns: [{ name: "chemical_id", data_type: "text" }] }, { name: "structures", source_sheets: ["Chemicals"], columns: [{ name: "chemical_id", data_type: "text", primary_key: true }, { name: "aliases", data_type: "set", list_name: true }] }] } };
  const column = m.mainColumns(doc).columns[0];
  assert.equal(column.lookup, "chemical");
  const q = m.lookupRequest(column.lookup, "Compound", column.lookupFields);
  assert.equal(q.query, "aliases LIKE '%Compound%'");
  assert.equal(m.lookupCandidates(response(q, [{ chemical_id: "abc", aliases: "Compound" }]), q).prediction.id, "abc");
});
test("debounce cancellation prevents work and rejects stale success and failure after abort", async () => {
  let calls = 0;
  const cancel = m.scheduleLookup(async () => { calls++; }, () => { calls++; }, () => { calls++; }, 10);
  cancel(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(calls, 0);
  let finish, signal;
  const cancelPending = m.scheduleLookup(s => { signal = s; return new Promise(resolve => { finish = resolve; }); }, () => { calls++; }, () => { calls++; }, 0);
  await new Promise(resolve => setTimeout(resolve, 10)); cancelPending(); finish("late"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(signal.aborted, true); assert.equal(calls, 0);
  let fail;
  const cancelFailure = m.scheduleLookup(() => new Promise((_, reject) => { fail = reject; }), () => { calls++; }, () => { calls++; }, 0);
  await new Promise(resolve => setTimeout(resolve, 10)); cancelFailure(); fail(new Error("late")); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(calls, 0);
});
test("only unique exact identities predict; duplicate joined rows collapse and ambiguity stays blank", () => {
  const q = m.lookupRequest("chemical", "compound");
  const row = { pubchemcid: "42", names: "alias=Compound" };
  assert.equal(m.lookupCandidates(response(q, [row, row]), q).prediction.id, "42");
  assert.equal(m.lookupCandidates(response(q, [row, { ...row, pubchemcid: "43" }]), q).prediction, undefined);
  assert.equal(m.lookupCandidates(response(q, [{ ...row, names: "Compound, stereoisomer" }]), q).prediction, undefined);
  assert.equal(m.lookupCandidates(response(q, []), q).prediction, undefined);
  const species = m.lookupRequest("species", "Ducrosia");
  assert.equal(m.lookupCandidates(response(species, [{ lsid_original: "1", genus_original: "Ducrosia", species_original: "anethifolia" }]), species).prediction, undefined);
});
test("schema failures, malformed rows and excess rows fail without partial predictions", () => {
  const q = m.lookupRequest("chemical", "compound");
  assert.throws(() => m.lookupCandidates({ metadata: [], data: [] }, q));
  assert.throws(() => m.lookupCandidates(response(q, [{ pubchemcid: 42, names: "compound" }]), q));
  assert.throws(() => m.lookupCandidates(response(q, Array(m.MAX_ROWS + 1).fill({ pubchemcid: "42", names: "compound" })), q));
  const result = m.lookupCandidates(response(q, Array.from({ length: 25 }, (_, i) => ({ pubchemcid: String(i), names: "compound" }))), q);
  assert.equal(result.candidates.length, 20); assert.equal(result.omitted, true); assert.equal(result.prediction, undefined);
});
test("manual selections and manual clears survive prediction refresh; unresolved predictions clear", () => {
  const manual = { id: "chosen", manual: true };
  assert.equal(m.predictedValue(manual, { id: "other", name: "Other" }), manual);
  const cleared = { id: "", manual: true };
  assert.equal(m.predictedValue(cleared, { id: "other" }), cleared);
  assert.equal(m.predictedValue({ id: "old", manual: false }).id, "");
});
test("incomplete projected results never predict and chemical signs are not discarded", () => {
  const q = m.lookupRequest("chemical", "(+)-Compound");
  const payload = response(q, [{ pubchemcid: "42", names: "(+)-Compound" }]);
  assert.equal(m.lookupCandidates({ ...payload, truncated: true }, q).prediction, undefined);
  assert.equal(m.lookupCandidates({ ...payload, truncated: true }, q).omitted, true);
  assert.equal(m.lookupCandidates(payload, q).prediction.id, "42");
  assert.equal(m.lookupCandidates(response(q, [{ pubchemcid: "43", names: "(-)-Compound" }]), q).prediction, undefined);
  assert.equal(m.lookupRequest("species", "anethifolia", undefined, true).query, "species_original LIKE 'anethifolia%'");
});
test("formula prefixes are neutralized equally in TSV and HTML without losing cells", () => {
  for (const value of ["=1+2", "+cmd", "-cmd", "@SUM(A1)", "  =1", "\t=1"]) {
    const result = m.exportPayload(columns, [{ referenceid: value }], false);
    assert.ok(result.text.startsWith("'")); assert.equal(result.text.split("\t").length, 4); assert.ok(result.html.includes("<td>'"));
  }
  assert.equal(m.exportPayload(columns, [{ referenceid: "reference-key" }], false).text, "reference-key\t\t\t");
});
test("HTML and TSV preserve trailing blank cells, selected order and optional headers", () => {
  const payload = m.exportPayload(columns, [{ pubchemcid: "42", referenceid: "<ref>\nnext" }, { lsid_original: "id" }], true);
  assert.equal(payload.text, "referenceid\tpubchemcid\tlsid_original\tempty\r\n<ref> next\t42\t\t\r\n\t\tid\t");
  assert.match(payload.html, /&lt;ref&gt; next/); assert.match(payload.html, /<td><\/td><td><\/td><\/tr>/);
  assert.equal(m.exportPayload(columns, [{}], false).text, "\t\t\t");
});
test("synchronous rich clipboard fallback requires populated event and always removes listener", async () => {
  const old = globalThis.document;
  let listener; const writes = [];
  globalThis.document = { addEventListener(_, callback) { listener = callback; }, removeEventListener() { listener = undefined; }, execCommand() { listener({ clipboardData: { setData(...args) { writes.push(args); } }, preventDefault() {} }); return true; } };
  try { assert.equal(await m.copyExport({ text: "a\t", html: "<table></table>" }, () => writes.push("select")), "rich"); assert.equal(writes[0], "select"); assert.deepEqual(writes[1], ["text/plain", "a\t"]); assert.equal(listener, undefined); }
  finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; }
});
test("clipboard unavailability reports failure instead of claiming a successful copy", async () => {
  const old = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {}, execCommand() { return true; } };
  try { await assert.rejects(m.copyExport({ text: "", html: "" }, () => {})); }
  finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; }
});
