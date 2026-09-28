import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const caddyfile = readFileSync(new URL("../Caddyfile", import.meta.url), "utf8");
const frontendConfig = readFileSync(new URL("../src/config.tsx", import.meta.url), "utf8");

test("frontend container serves the SPA without nginx PID files", () => {
  assert.match(dockerfile, /^FROM caddy:2\.10\.2-alpine AS production$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(dockerfile, /^USER 65532:65532$/m);
  assert.match(dockerfile, /^ENV XDG_CONFIG_HOME=\/tmp\/caddy-config \\$/m);
  assert.match(dockerfile, /^\s*XDG_DATA_HOME=\/tmp\/caddy-data$/m);
  assert.doesNotMatch(dockerfile, /nginx/i);
  assert.match(caddyfile, /^:8080 \{$/m);
  assert.match(caddyfile, /^\s*root \* \/srv$/m);
  assert.match(caddyfile, /^\s*try_files \{path\} \/index\.html$/m);
  assert.match(caddyfile, /^\s*file_server$/m);
  assert.match(caddyfile, /^\s*\/auth\/\* \\$/m);
  assert.match(caddyfile, /^\s*\/config \\$/m);
  assert.match(caddyfile, /^\s*\/get-tables-list \\$/m);
  assert.match(caddyfile, /^\s*@search_api \{$/m);
  assert.match(caddyfile, /^\s*path \/search$/m);
  assert.match(caddyfile, /^\s*query q=\*$/m);
  assert.match(caddyfile, /^\s*reverse_proxy \{\$FURANO_BACKEND_ORIGIN:https:\/\/176\.108\.251\.108\.nip\.io\}/m);
  assert.match(frontendConfig, /import\.meta\.env\.PROD\s*\?\s*window\.location\.origin/);
});

test("image library navigation stays in the SPA while authenticated image API requests reach the backend", () => {
  const backendPaths = caddyfile.slice(caddyfile.indexOf("@backend path"), caddyfile.indexOf("/bibtex"));
  assert.doesNotMatch(backendPaths, /^\s*\/admin\/images\s*\\$/m);
  assert.match(backendPaths, /^\s*\/admin\/images\/\*\s*\\$/m);
  assert.match(caddyfile, /@image_upload\s*\{\s*path \/admin\/images\s+method POST\s*\}/);
  assert.match(caddyfile, /handle @image_upload\s*\{\s*reverse_proxy/);
  assert.match(caddyfile, /@image_page\s*\{\s*path \/admin\/images \/admin\/images\/\s+method GET HEAD\s*\}/);
  assert.match(caddyfile, /handle @image_page\s*\{\s*root \* \/srv\s+try_files \{path\} \/index\.html\s+file_server/);
  const library = readFileSync(new URL("../src/Admin/ImageLibrary.tsx", import.meta.url), "utf8");
  assert.match(library, /api\.get<Image\[\]>\(`\$\{endpoint\}\/list`/);
});
