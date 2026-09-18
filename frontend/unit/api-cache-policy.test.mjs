import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const cache = await server.ssrLoadModule("/src/shared/apiCache.ts");
const { api } = await server.ssrLoadModule("/src/shared/api.ts");

test("explicit public cache endpoints use exact keys while autocomplete stays memory-only", async () => {
  const originalGet = api.get;
  const calls = [];
  try {
    await cache.clearApiCache();
    api.get = async (url, options) => {
      calls.push([url, options?.params]);
      return { status: 200, data: { url, params: options?.params } };
    };

    await cache.cachedPublicConfig();
    await cache.cachedPublicConfig();
    await cache.cachedTaxon(1, "Angelica", "dataset-v1");
    await cache.cachedTaxon(1, "Angelica", "dataset-v1");
    await cache.cachedTaxon(1, "Angelica", "dataset-v2");
    await cache.cachedAutocomplete("/autocomplete", { value: "an", scope: "search" });
    await cache.cachedAutocomplete("/autocomplete", { scope: "search", value: "an" });
    // Delimiters in values must not collide with another parameter shape.
    await cache.cachedAutocomplete("/autocomplete", { value: "a&scope=other" });
    await cache.cachedAutocomplete("/autocomplete", { value: "a", scope: "other" });

    assert.deepEqual(calls, [
      ["/config", undefined],
      ["/taxa/1", { name: "Angelica" }],
      ["/taxa/1", { name: "Angelica" }],
      ["/autocomplete", { value: "an", scope: "search" }],
      ["/autocomplete", { value: "a&scope=other" }],
      ["/autocomplete", { value: "a", scope: "other" }],
    ]);
    const entries = await cache.listApiCache();
    assert.equal(entries.some(entry => entry.kind === "autocomplete" && entry.sources.includes("idb")), false);
  } finally {
    api.get = originalGet;
    await cache.clearApiCache();
  }
});

test("aborting one public-cache consumer never shares its request with another", async () => {
  const originalGet = api.get;
  const first = new AbortController();
  const second = new AbortController();
  const signals = [];
  let resolveSecond;
  try {
    await cache.clearApiCache();
    api.get = (_url, options) => new Promise((resolve, reject) => {
      signals.push(options?.signal);
      if (options?.signal === first.signal) {
        first.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      } else {
        resolveSecond = () => resolve({ status: 200, data: {} });
      }
    });
    const aborted = cache.cachedPublicConfig({ signal: first.signal });
    const live = cache.cachedPublicConfig({ signal: second.signal });
    for (let attempt = 0; signals.length < 2 && attempt < 10; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.deepEqual(signals, [first.signal, second.signal]);
    first.abort();
    resolveSecond();
    await assert.rejects(aborted, /aborted/);
    await live;
  } finally {
    api.get = originalGet;
    await cache.clearApiCache();
  }
});

test("taxon cache keys cannot outlive a changed active metadata timestamp", async () => {
  const originalGet = api.get;
  let calls = 0;
  try {
    await cache.clearApiCache();
    api.get = async () => ({ status: 200, data: { request: ++calls } });
    await cache.cachedTaxon(0, "cordifolium", "active-before");
    await cache.cachedTaxon(0, "cordifolium", "active-before");
    await cache.cachedTaxon(0, "cordifolium", "active-after");
    assert.equal(calls, 2);
  } finally {
    api.get = originalGet;
    await cache.clearApiCache();
  }
});

test("TaxonPage obtains its dataset identity fresh before reading a cached taxon", async () => {
  const page = await readFile(new URL("../src/TaxonPage/TaxonomyPage.tsx", import.meta.url), "utf8");
  assert.match(page, /api\.get<MetadataResponse>\("\/metadata", \{ params: \{ taxon_cache_key: Date\.now\(\) \} \}\)/);
  assert.match(page, /cachedTaxon\(rank, name, data\.timestamp\)/);
});

test("page and About invalidation remove only their exact public resource", async () => {
  const originalGet = api.get;
  let calls = 0;
  try {
    await cache.clearApiCache();
    api.get = async (url) => ({ status: 200, data: `${url}:${++calls}` });
    await cache.cachedEditablePage("about");
    await cache.cachedEditablePage("about");
    await cache.invalidateCachedEditablePage("about");
    await cache.cachedEditablePage("about");
    await cache.cachedAboutPages();
    await cache.invalidateCachedAboutPages();
    await cache.cachedAboutPages();
    assert.equal(calls, 4);
  } finally {
    api.get = originalGet;
    await cache.clearApiCache();
  }
});
