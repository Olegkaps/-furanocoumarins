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
  assert.match(caddyfile, /^\s*\/get-tables-list \\$/m);
  assert.match(caddyfile, /^\s*reverse_proxy \{\$FURANO_BACKEND_ORIGIN:https:\/\/176\.108\.251\.108\.nip\.io\}/m);
  assert.match(frontendConfig, /import\.meta\.env\.PROD\s*\?\s*window\.location\.origin/);
});
