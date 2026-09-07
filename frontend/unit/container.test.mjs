import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const nginxMainConfig = readFileSync(new URL("../nginx-main.conf", import.meta.url), "utf8");
const nginxConfig = readFileSync(new URL("../nginx.conf", import.meta.url), "utf8");

test("frontend container runs nginx without root-only runtime paths", () => {
  assert.match(dockerfile, /^FROM nginxinc\/nginx-unprivileged:stable-alpine AS production$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(dockerfile, /^COPY nginx-main\.conf \/etc\/nginx\/nginx\.conf$/m);
  assert.doesNotMatch(dockerfile, /^FROM nginx:stable-alpine AS production$/m);
  assert.match(nginxMainConfig, /^pid \/tmp\/nginx\.pid;$/m);
  assert.doesNotMatch(nginxMainConfig, /(?:^|\s)\/run\/nginx\.pid/);
  for (const path of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]) {
    assert.match(nginxMainConfig, new RegExp(`^\\s*${path}_temp_path /tmp/`, "m"));
  }
  assert.match(nginxConfig, /^\s*listen\s+8080;$/m);
  assert.match(nginxConfig, /^\s*listen\s+\[::\]:8080;$/m);
  assert.doesNotMatch(nginxConfig, /^\s*listen\s+(?:\[::\]:)?80;$/m);
});
