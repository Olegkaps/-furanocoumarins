#!/bin/sh
set -eu
compose=${COMPOSE:-"podman compose"}
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "==> failure diagnostics: backend + Cassandra"
    for service in backend cassandra; do
      $compose -f docker-compose.auth-test.yaml logs "$service" || true
    done
  fi
  test -z "${vite_pid:-}" || kill "$vite_pid" 2>/dev/null || true
  $compose -f docker-compose.auth-test.yaml down -v >/dev/null 2>&1 || true
  return "$status"
}

verify_import_rerun() {
  echo "==> importer rerun: preserve password, repair memberships, keep one audit row"
  $compose -f docker-compose.auth-test.yaml stop backend authd
  $compose -f docker-compose.auth-test.yaml exec -T auth-postgres \
    psql -v ON_ERROR_STOP=1 -U auth -d auth -c \
	"DROP TABLE IF EXISTS importer_e2e_password_snapshot; DROP TABLE IF EXISTS importer_e2e_membership_snapshot;
	 CREATE TABLE importer_e2e_password_snapshot AS SELECT id, password_hash FROM users WHERE login = 'migrated';
	 CREATE TABLE importer_e2e_membership_snapshot AS
	 SELECT membership.id, role.name FROM user_roles membership JOIN users u ON u.id = membership.user_id JOIN roles role ON role.id = membership.role_id
	 WHERE u.login = 'migrated' AND role.name IN ('admin', 'superuser');
	 INSERT INTO role_tags (role_id, tag) SELECT role.id, 'import-preserved' FROM roles role WHERE role.name = 'admin' ON CONFLICT DO NOTHING;
	 INSERT INTO user_role_tags (user_role_id, tag) SELECT membership.id, 'import-preserved' FROM user_roles membership JOIN users u ON u.id = membership.user_id JOIN roles role ON role.id = membership.role_id WHERE u.login = 'migrated' AND role.name = 'admin' ON CONFLICT DO NOTHING;"
  $compose -f docker-compose.auth-test.yaml exec -T auth-postgres \
    psql -v ON_ERROR_STOP=1 -U auth -d auth -c \
	"UPDATE user_roles membership SET
	 level = CASE role.name WHEN 'admin' THEN 'role_admin'::role_level ELSE 'direct_member'::role_level END,
	 valid_from = CASE role.name WHEN 'admin' THEN NOW() + INTERVAL '7 days' ELSE NOW() - INTERVAL '7 days' END,
	 valid_until = CASE role.name WHEN 'admin' THEN NULL ELSE NOW() - INTERVAL '1 day' END
	 FROM users u, roles role WHERE membership.user_id = u.id AND membership.role_id = role.id AND u.login = 'migrated' AND role.name IN ('admin', 'superuser');"
  for pass in repair exact-rerun; do
    $compose -f docker-compose.auth-test.yaml run --rm --no-deps auth-import
    verification="$($compose -f docker-compose.auth-test.yaml exec -T auth-postgres \
      psql -v ON_ERROR_STOP=1 -U auth -d auth -Atc \
      "SELECT CASE WHEN u.password_hash IS NOT NULL
        AND u.password_hash IS NOT DISTINCT FROM snapshot.password_hash
        AND u.superuser AND u.login = 'migrated' AND u.email = 'migrated.user@example.test'
		AND (SELECT COUNT(*) FROM user_roles membership JOIN roles role ON role.id = membership.role_id JOIN importer_e2e_membership_snapshot snapshot_membership ON snapshot_membership.id = membership.id AND snapshot_membership.name = role.name WHERE membership.user_id = u.id AND role.name IN ('admin', 'superuser') AND membership.valid_from <= NOW() AND membership.valid_until IS NULL) = 2
		AND (SELECT level::text FROM user_roles membership JOIN roles role ON role.id = membership.role_id WHERE membership.user_id = u.id AND role.name = 'admin') = 'role_admin'
		AND (SELECT level::text FROM user_roles membership JOIN roles role ON role.id = membership.role_id WHERE membership.user_id = u.id AND role.name = 'superuser') = 'member'
		AND (SELECT COUNT(*) FROM user_role_tags grant_tag JOIN user_roles membership ON membership.id = grant_tag.user_role_id JOIN roles role ON role.id = membership.role_id WHERE membership.user_id = u.id AND role.name = 'admin' AND grant_tag.tag = 'import-preserved') = 1
        AND (SELECT COUNT(*) FROM external_user_imports audit WHERE audit.source_system = 'furanocoumarins' AND audit.source_user_id = 1 AND audit.target_user_id = u.id) = 1
        THEN 'ok' ELSE 'invalid' END
      FROM users u JOIN importer_e2e_password_snapshot snapshot ON snapshot.id = u.id
      WHERE u.login = 'migrated';")"
    test "${verification}" = "ok" || { echo "importer ${pass} verification failed" >&2; return 1; }
  done
  $compose -f docker-compose.auth-test.yaml exec -T auth-postgres \
	psql -v ON_ERROR_STOP=1 -U auth -d auth -c "DROP TABLE importer_e2e_password_snapshot; DROP TABLE importer_e2e_membership_snapshot;"
  $compose -f docker-compose.auth-test.yaml up -d authd backend
}
trap cleanup EXIT INT TERM
$compose -f docker-compose.auth-test.yaml down -v >/dev/null 2>&1 || true
$compose -f docker-compose.auth-test.yaml build auth-import authd backend
$compose -f docker-compose.auth-test.yaml up -d auth-postgres source-postgres mailpit cassandra authd
i=0
until $compose -f docker-compose.auth-test.yaml exec -T authd /healthcheck >/dev/null 2>&1; do i=$((i+1)); test "$i" -lt 90 || { $compose -f docker-compose.auth-test.yaml logs authd auth-postgres; exit 1; }; sleep 1; done
i=0
until $compose -f docker-compose.auth-test.yaml exec -T cassandra cqlsh -e 'DESCRIBE CLUSTER' >/dev/null 2>&1; do i=$((i+1)); test "$i" -lt 180 || { $compose -f docker-compose.auth-test.yaml logs cassandra; exit 1; }; sleep 1; done
$compose -f docker-compose.auth-test.yaml exec -T cassandra cqlsh -f /schema.cql
# Model an upgrade from the last production schema: the singleton activation
# table is absent, while one Ready row is marked active in the legacy registry.
$compose -f docker-compose.auth-test.yaml exec -T cassandra cqlsh -e \
  "INSERT INTO chemdb.tables (created_at, name, version, table_meta, table_data, table_species, is_active, is_ok) VALUES ('2000-01-01T00:00:00Z', 'legacy-upgrade-fixture', 'v2', 'chemdb.upgrade_meta', 'chemdb.upgrade_data', 'chemdb.upgrade_species', true, true);"
$compose -f docker-compose.auth-test.yaml stop authd
$compose -f docker-compose.auth-test.yaml exec -T auth-postgres \
  psql -v ON_ERROR_STOP=1 -U auth -d auth -c \
  "INSERT INTO roles (id, name, description, created_at, updated_at)
   SELECT (SUBSTR(hash,1,8)||'-'||SUBSTR(hash,9,4)||'-'||SUBSTR(hash,13,4)||'-'||SUBSTR(hash,17,4)||'-'||SUBSTR(hash,21,12))::uuid,
          'fixture-role-'||LPAD(value::text,2,'0'), 'pagination fixture', NOW(), NOW()
   FROM (SELECT value, MD5('fixture-role-'||value::text) AS hash FROM generate_series(1,30) value) fixture
   ON CONFLICT DO NOTHING;
   INSERT INTO roles (id, name, description, created_at, updated_at)
   SELECT (SUBSTR(hash,1,8)||'-'||SUBSTR(hash,9,4)||'-'||SUBSTR(hash,13,4)||'-'||SUBSTR(hash,17,4)||'-'||SUBSTR(hash,21,12))::uuid,
          '00-admin-fixture-'||LPAD(value::text,2,'0'), 'admin discovery pagination fixture', NOW(), NOW()
   FROM (SELECT value, MD5('00-admin-fixture-'||value::text) AS hash FROM generate_series(1,30) value) fixture
   ON CONFLICT DO NOTHING;"
$compose -f docker-compose.auth-test.yaml run --rm --no-deps auth-import
$compose -f docker-compose.auth-test.yaml up -d authd backend
i=0
until curl -fsS http://localhost:8081/ping >/dev/null; do i=$((i+1)); test "$i" -lt 90 || { $compose -f docker-compose.auth-test.yaml logs; exit 1; }; sleep 1; done
upgrade_state="$($compose -f docker-compose.auth-test.yaml exec -T cassandra cqlsh -e "SELECT active_created_at FROM chemdb.table_activation WHERE scope = 'current';")"
printf '%s\n' "${upgrade_state}" | grep -Fq '2000-01-01' || {
  echo "backend startup did not migrate the legacy active-table pointer" >&2
  exit 1
}
# Remove the upgrade-only fixture. The first table-list request initializes an
# empty pointer and the browser journey then imports its own real datasets.
$compose -f docker-compose.auth-test.yaml exec -T cassandra cqlsh -e \
  "DELETE FROM chemdb.tables WHERE created_at = '2000-01-01T00:00:00Z'; DELETE FROM chemdb.table_activation WHERE scope = 'current'; INSERT INTO chemdb.tables (created_at, name, version, table_meta, table_data, table_species, is_active, is_ok) VALUES ('2001-01-01T00:00:00Z', 'activation-not-ready-fixture', 'v2', 'chemdb.not_ready_meta', 'chemdb.not_ready_data', 'chemdb.not_ready_species', false, false);"
# Deliberately use the checked-in frontend/backend defaults here. This makes
# the browser journey regress the local first-use CORS contract rather than an
# E2E-only origin override.
(cd frontend && exec ./node_modules/.bin/vite --host localhost --port 5173 --strictPort) >/tmp/furanocoumarins-vite.log 2>&1 & vite_pid=$!
i=0
until curl -fsS http://localhost:5173/login >/dev/null; do i=$((i+1)); test "$i" -lt 60 || { cat /tmp/furanocoumarins-vite.log; exit 1; }; sleep 1; done
if [ "$(uname -s)" = Darwin ] && [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]; then
  shell_path=$(cd frontend && node -e 'console.log(require("@playwright/test").chromium.executablePath())')
  normal_path=$(printf '%s' "$shell_path" | sed 's/chromium_headless_shell/chromium/; s#chrome-mac/headless_shell#chrome-mac/Chromium.app/Contents/MacOS/Chromium#')
  if [ -x "$normal_path" ]; then PLAYWRIGHT_CHROMIUM_EXECUTABLE=$normal_path; export PLAYWRIGHT_CHROMIUM_EXECUTABLE; fi
fi
if ! (cd frontend && node -e 'const fs=require("fs"); const {chromium}=require("@playwright/test"); fs.accessSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(), fs.constants.X_OK)'); then
  echo "Playwright Chromium is missing; run 'make install-e2e'" >&2
  exit 1
fi
(cd frontend && npm run test:e2e)
$compose -f docker-compose.auth-test.yaml stop mailpit
(cd frontend && VERIFY_SMTP_FAILURE=1 npm run test:e2e -- --grep "magic start hides delivery failure")
$compose -f docker-compose.auth-test.yaml up -d mailpit
verify_import_rerun
(cd frontend && VERIFY_REPAIRED_MEMBERSHIP=1 npm run test:e2e -- --grep "repaired imported memberships")
