import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

test("production Ketcher renderer bundles Raphael without a browser require", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = await build({
    root,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: `${root}/node_modules/ketcher-core/dist/application/render/raphael-ext.modern.js`,
      },
    },
  });
  const chunks = result.output.filter(output => output.type === "chunk");
  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.doesNotMatch(chunk.code, /\brequire\s*\(\s*["']raphael["']\s*\)/);
  }
});
