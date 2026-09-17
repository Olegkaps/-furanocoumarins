import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom",
});
after(() => server.close());
const { readPublicConfig, loadPublicConfig } = await server.ssrLoadModule("/src/shared/publicConfig.ts");
const { api } = await server.ssrLoadModule("/src/shared/api.ts");

test("public config accepts only declared string UI copy", () => {
  assert.deepEqual(readPublicConfig({
    taxonomy_info: "Current sources",
    classification_autocomplete_label: "parent + child",
    classification_autocomplete_hint: "From configured ranks",
    ignored: "not exposed",
  }), {
    taxonomy_info: "Current sources",
    classification_autocomplete_label: "parent + child",
    classification_autocomplete_hint: "From configured ranks",
  });
  assert.deepEqual(readPublicConfig(null), {});
});

test("public config loader requests the fixed endpoint and falls back safely", async () => {
  const originalGet = api.get;
  try {
    let requested;
    api.get = async (path, options) => {
      requested = [path, options];
      return { data: { classification_autocomplete_hint: "Configured note" } };
    };
    assert.deepEqual(await loadPublicConfig(), { classification_autocomplete_hint: "Configured note", taxonomy_info: undefined, classification_autocomplete_label: undefined });
    assert.equal(requested[0], "/config");
    api.get = async () => { throw new Error("offline"); };
    assert.deepEqual(await loadPublicConfig(), {});
  } finally {
    api.get = originalGet;
  }
});
