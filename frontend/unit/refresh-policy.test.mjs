import test from "node:test";
import assert from "node:assert/strict";

import {
  createAccessTokenRecovery,
  hasCoherentCredential,
  newerAccessTokenForRetry,
} from "../src/shared/refreshPolicy.mjs";
import {
  createSessionEpoch,
  finalizeRotatedCredential,
} from "../src/shared/sessionEpoch.mjs";
import {
  getMetadataTypeModifier,
  hasMetadataTypeToken,
  parseMetadataType,
  safeMetadataLink,
} from "../src/shared/metadataType.mjs";

test("late stale-token failures reuse the newest rotated access token", () => {
  assert.equal(newerAccessTokenForRetry("Bearer access-v1", "access-v2"), "access-v2");
  assert.equal(newerAccessTokenForRetry("Bearer access-v1", "access-v3"), "access-v3");
});

test("the current token generation still requires the single refresh winner", () => {
  assert.equal(newerAccessTokenForRetry("Bearer access-v2", "access-v2"), null);
  assert.equal(newerAccessTokenForRetry("Basic access-v1", "access-v2"), null);
  assert.equal(newerAccessTokenForRetry("Bearer ", "access-v2"), null);
  assert.equal(newerAccessTokenForRetry("Bearer access-v1", null), null);
});

test("authenticated routing accepts body-token and cookie-backed sessions", () => {
  assert.equal(hasCoherentCredential("access", "refresh"), true);
  assert.equal(hasCoherentCredential("access", null, "csrf"), true);
  assert.equal(hasCoherentCredential("access", null), false);
  assert.equal(hasCoherentCredential(null, "refresh"), false);
  assert.equal(hasCoherentCredential(null, null, "csrf"), false);
  assert.equal(hasCoherentCredential("", "refresh"), false);
  assert.equal(hasCoherentCredential("access", ""), false);
});

test("concurrent and late 401s for one generation rotate only once", async () => {
  let currentAccessToken = "access-v1";
  let rotateCalls = 0;
  let releaseRotation;
  const rotationGate = new Promise((resolve) => {
    releaseRotation = resolve;
  });
  const recovery = createAccessTokenRecovery(
    () => currentAccessToken,
    async () => {
      rotateCalls += 1;
      await rotationGate;
      currentAccessToken = "access-v2";
      return currentAccessToken;
    },
  );

  const first = recovery.recover("Bearer access-v1");
  const concurrent = recovery.recover("Bearer access-v1");
  await Promise.resolve();
  assert.equal(rotateCalls, 1);
  releaseRotation();
  assert.equal(await first, "access-v2");
  assert.equal(await concurrent, "access-v2");

  // Model a late interceptor observing stale storage after the winner settled.
  // Without the completed-generation entry this starts a second rotation.
  currentAccessToken = "access-v1";
  assert.equal(await recovery.recover("Bearer access-v1"), "access-v2");
  assert.equal(rotateCalls, 1);
});

test("a rejected replacement generation can start one new recovery", async () => {
  let currentAccessToken = "access-v1";
  let rotateCalls = 0;
  const recovery = createAccessTokenRecovery(
    () => currentAccessToken,
    async () => {
      rotateCalls += 1;
      currentAccessToken = `access-v${rotateCalls + 1}`;
      return currentAccessToken;
    },
  );

  assert.equal(await recovery.recover("Bearer access-v1"), "access-v2");
  assert.equal(await recovery.recover("Bearer access-v2"), "access-v3");
  assert.equal(rotateCalls, 2);
});

test("logout during refresh cannot resurrect storage and revokes the rotated winner", async () => {
  const epoch = createSessionEpoch();
  const storage = new Map([
    ["access", "access-v1"],
    ["refresh", "refresh-v1"],
  ]);
  const revoked = [];
  let releaseRotation;
  const rotationGate = new Promise((resolve) => {
    releaseRotation = resolve;
  });
  const recovery = createAccessTokenRecovery(
    () => storage.get("access") ?? null,
    async () => {
      const captured = epoch.capture();
      await rotationGate;
      return finalizeRotatedCredential(
        epoch,
        captured,
        { accessToken: "access-v2", refreshToken: "refresh-v2" },
        (credential) => {
          storage.set("access", credential.accessToken);
          storage.set("refresh", credential.refreshToken);
        },
        async (credential) => {
          revoked.push(credential.refreshToken);
        },
      );
    },
  );

  const pending = recovery.recover("Bearer access-v1");
  await Promise.resolve();
  epoch.invalidate();
  recovery.reset();
  storage.clear();
  releaseRotation();

  await assert.rejects(pending, /session changed/);
  await recovery.waitForIdle();
  assert.deepEqual([...storage.entries()], []);
  assert.deepEqual(revoked, ["refresh-v2"]);
});

test("metadata labels use exact tokens outside modifier arguments", () => {
  assert.equal(hasMetadataTypeToken("text search chemical", "search"), true);
  assert.equal(hasMetadataTypeToken("research", "search"), false);
  assert.equal(hasMetadataTypeToken("offset", "set"), false);
  assert.equal(hasMetadataTypeToken("external[sunset]", "set"), false);
  assert.equal(hasMetadataTypeToken("ref[]", "ref[]"), true);
  assert.equal(hasMetadataTypeToken("link[https://example.test/specie/%s]", "specie"), false);
  assert.equal(hasMetadataTypeToken("clas[chemical]", "chemical"), false);
  assert.equal(hasMetadataTypeToken("default[table_]", "table_"), false);
  assert.equal(hasMetadataTypeToken("table_specie", "specie"), true);
  assert.equal(hasMetadataTypeToken("table_specie", "table_"), true);
  assert.equal(hasMetadataTypeToken("table_chemical", "chemical"), true);
  assert.equal(hasMetadataTypeToken("table_chemical", "table_"), true);
  assert.equal(hasMetadataTypeToken("table_0 keycolumn chemical", "table_"), true);
  assert.equal(hasMetadataTypeToken("table_12 keycolumn specie", "table_"), true);
  assert.equal(hasMetadataTypeToken("table_name chemical", "table_"), false);
  assert.equal(hasMetadataTypeToken("default[table_0] chemical", "table_"), false);
  assert.equal(hasMetadataTypeToken("link[https://example.test/table_specie/%s]", "specie"), false);
  assert.equal(hasMetadataTypeToken("table_chemical SMILES", "SMILES"), true);
  assert.equal(hasMetadataTypeToken("table_chemical smiles", "SMILES"), true);
  assert.equal(hasMetadataTypeToken("table_chemical SMILES", "smiles"), true);
  assert.equal(hasMetadataTypeToken("table_chemical Smiles", "SMILES"), false);
  assert.equal(hasMetadataTypeToken("table_chemical list_name", "list_name"), true);
  assert.equal(hasMetadataTypeToken("link[/fields/list_name/%s]", "list_name"), false);
});

test("metadata links allow HTTPS and safe relative destinations only", () => {
  assert.equal(safeMetadataLink("https://example.test/articles/%s", "ref-1"), "https://example.test/articles/ref-1");
  assert.equal(safeMetadataLink("https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:%s", "2639224-4"), "https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:2639224-4");
  assert.equal(safeMetadataLink("https://example.test/articles/ref-%s", "../logout"), "https://example.test/articles/ref-..%2Flogout");
  assert.equal(safeMetadataLink("/articles/%s", "ref-1"), "/articles/ref-1");
  assert.equal(safeMetadataLink("/articles/%s", "case report 1"), "/articles/case%20report%201");
  assert.equal(safeMetadataLink("/articles/%s", "case\u202freport"), "/articles/case%E2%80%AFreport");
  assert.equal(safeMetadataLink("https://example.test/articles/%s", "../logout"), "https://example.test/articles/..%2Flogout");
  assert.equal(safeMetadataLink("/articles/%s", "/logout"), "/articles/%2Flogout");
  assert.equal(safeMetadataLink("/articles/%s", "?admin=1"), "/articles/%3Fadmin%3D1");
  assert.equal(safeMetadataLink("/articles/%s", "#danger"), "/articles/%23danger");
  assert.equal(safeMetadataLink("/articles/%s", "%2Flogout"), "/articles/%252Flogout");
  assert.equal(safeMetadataLink("/articles/%s", "%5Clogout"), "/articles/%255Clogout");
  assert.equal(safeMetadataLink("/articles/%s", ".."), "/articles/%252E%252E");
  assert.equal(safeMetadataLink("%s", "https://legacy.example.test/ref-1"), null);
  assert.equal(safeMetadataLink("https://%s/path", "evil.example"), null);
  assert.equal(safeMetadataLink("https://%s.example.test/path", "evil"), null);
  assert.equal(safeMetadataLink("javascript:%s", "alert(1)"), null);
  assert.equal(safeMetadataLink("data:text/html,%s", "payload"), null);
  assert.equal(safeMetadataLink("http://example.test/%s", "ref-1"), null);
  assert.equal(safeMetadataLink("%s", "//evil.example/ref-1"), null);
  assert.equal(safeMetadataLink("%s", "javascript:alert(1)"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "line\njavascript:alert(1)"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "tab\tvalue"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "nul\u0000value"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "delete\u007fvalue"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "control\u0085value"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "invalid\ud800value"), null);
  assert.equal(safeMetadataLink("https://example.test/%s", "ref\\evil"), null);
  assert.equal(safeMetadataLink("https://user@example.test/%s", "ref-1"), null);
  assert.equal(safeMetadataLink("https://example.test/%s/%s", "ref-1"), null);
  assert.equal(safeMetadataLink("https://example.test/?id=%s", "ref-1"), null);
  assert.equal(safeMetadataLink("https://example.test/path#%s", "ref-1"), null);
});

test("metadata modifiers preserve clas, link, and finite set arguments", () => {
  assert.deepEqual(getMetadataTypeModifier("table_specie clas[01]", "clas"), ["01"]);
  assert.deepEqual(getMetadataTypeModifier("clas[01][gbif] table_specie", "clas"), ["01", "gbif"]);
  assert.deepEqual(getMetadataTypeModifier("table_ link[https://example.test/articles/%s]", "link"), ["https://example.test/articles/%s"]);
  assert.deepEqual(getMetadataTypeModifier("chemical search set[Bergapten Psoralen]", "set"), ["Bergapten Psoralen"]);
  assert.equal(hasMetadataTypeToken("chemical search set[Bergapten Psoralen]", "set"), true);
});

test("malformed and duplicate structured modifiers are rejected", () => {
  for (const columnType of [
    "clas", "clas[]", "clas[01][]", "clas[01][tag][extra]", "clas[01] clas[02]",
    "link", "link[]", "link[url][extra]", "link[url] link[other]",
    "set[]", "set[a][b]", "set[a] set", "set set[a]", "set[a] set[b]",
  ]) {
    assert.equal(parseMetadataType(columnType), null, columnType);
  }
});
