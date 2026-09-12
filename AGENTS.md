# AGENTS.md — furanocoumarins

Furanocoumarins data application with a Go/Fiber backend and React/Vite UI.
**auth-master is the only runtime identity and authorization source.**

## Purpose

The public UI searches and presents furanocoumarin data. Authenticated admins
maintain tables, BibTeX, and editable pages; superusers additionally manage
accounts, invitations, bans, roles, sessions, and signing-key rotation.

## Architecture

- `backend/admin/internal/infrastructure/authmaster` — bounded, redirect-safe
  client for the private authd service.
- `backend/admin/internal/presentation/http/authmaster` — fixed same-origin BFF
  routes and Fiber authorization middleware.
- `backend/admin/internal/presentation/http/{create,bibtex,pages,tables}` —
  domain handlers; mutations sit behind `RequireAdmin`.
- `backend/admin/internal/migration/authmaster` and
  `backend/admin/cmd/import-furanocoumarins` — side-owned offline identity import.
- `backend/admin/internal/application/create` — workbook validation, unjoined
  source preservation, and joined search-table construction.
- `backend/admin/internal/pkg/metadata` — structured import definitions and
  legacy declaration conversion; independent of persistence and presentation.
- `backend/admin/internal/migration/cassandrapostgres` and
  `backend/admin/cmd/migrate-cassandra-postgres` — offline scientific-data cutover;
  Cassandra is not a runtime dependency.
- `frontend/src/Admin` — password and magic login, reset, registration,
  sessions, and superuser management.
- `frontend/src/SearchApp`, `About`, `Reference`, and `SubstancePage` — public
  domain UI; auth changes must not alter these workflows.
- `docker-compose.auth-test.yaml` and `scripts/auth-e2e.sh` — isolated migration,
  authd, Mailpit, BFF, and Playwright validation.

## Authentication flow

1. The browser talks only to the same-origin allowlisted `/auth/*` BFF routes;
   authd has no public host port in the production Compose stack.
2. Established users sign in with password plus email OTP. Refresh tokens
   rotate, and replay of an old token is rejected.
3. Migrated users may keep using magic links indefinitely without setting a
   password. Their sessions have normal RBAC and superuser authority. The
   forgot-password flow optionally establishes or replaces a password.
4. Every protected request revalidates the access token through authd. Do not
   verify auth-master JWTs locally or cache user, ban, superuser, or role state.
5. Redirects, oversized responses, authd outages, and malformed upstream
   payloads fail closed. Forward only the explicitly required bearer, cookie,
   CSRF, content-type, and allowlisted query fields.

## Authorization rules

- Every data mutation requires the `admin` role. This includes table creation,
  activation and deletion, BibTeX replacement, and editable-page writes.
- Password presence is never an authorization condition. Active passwordless
  users receive their imported memberships and superuser authority immediately.
- Only a verified superuser may create invitations, list or ban users, assign
  or remove roles, or rotate signing keys through this application.
- Read-only public endpoints stay public. The POST table-list endpoint is
  read-only but remains authenticated because it powers the admin panel.
- Handlers obtain the actor email from the verified auth-master `/v1/me`
  response, never from the legacy PostgreSQL users table or token claims.

## Migration

Run the offline importer with an explicit `FURANO_SUPERUSER`. Source emails may
contain mixed case; the importer canonicalizes identities, rejects collisions,
never reads or copies legacy password hashes, ensures `admin`, and makes the
selected user both admin and auth-master superuser. Exact reruns are safe and
must not overwrite passwords set after migration. Authd must initialize the
target schema first; stop both authd and go-auth before the atomic import.
For local Compose use direct `FURANO_SOURCE_DATABASE_URL` and
`FURANO_SUPERUSER` values. Production Swarm mounts their `_FILE` variants into
the side-owned importer job.

Scientific data uses PostgreSQL at runtime. The separate offline
`migrate-cassandra-postgres` command requires `FURANO_CASSANDRA_HOST` and
`FURANO_POSTGRES_DSN`. Read a quiesced legacy source, use an isolated target for
validation, and retain the original Cassandra volume until the migrated
application has been verified and backed up. Table schemas, content fingerprints,
and row counts participate in the cutover manifest; changed sources must not be
silently accepted on rerun.

## Unjoined source entities

Preserve every registered virtual workbook sheet before joining, including rows
not referenced by `main`. These are processed rows (defaults and set conversion
already applied), not byte-for-byte workbook archives. Preserve natural keys,
external reference keys, original column metadata, and physical sheet names.
Keep the joined table as the public search representation.

`classification` represents species and `structures` represents chemicals.
Optional `publication`/`publications` sheets represent workbook publications;
global `chemdb.bibtex` remains the independent bibliography. Never invent
publication records from `ref[]` values. Source-table catalogs belong to their
dataset, must migrate with it, and must be included in broken/deleted-dataset
cleanup without deleting global BibTeX. Publish Ready only after all source
tables and their catalog have been saved.

Legacy datasets without source catalogs still retain their existing species,
joined data, and bibliography. Do not claim original chemical/publication sheets
were recovered from joins: unreferenced rows may already have been lost. Reimport
the workbook to obtain complete unjoined sources.

## Versioned import metadata

`chemdb.metadata_versions` stores immutable JSON definitions. The schema format
(`schema_version`) and metadata version are separate from the backend's existing
`tables.version`. All metadata-management endpoints require `RequireAdmin`.
Publication creates a new version and rejects a stale `base_version`; it never
changes definitions already pinned by datasets.

New drafts require schema format 2; pinned format-1 definitions retain explicit
join semantics. Format 2 resolves shared non-primary column names against other
groups' primary keys, starting at `main`; ambiguous targets require an explicit
JSON override. Each non-main group has one key; main may use a generated row key.
The admin validation endpoint returns the resolved copy without persisting it.
Use that copy for join and public-view previews, not a second join algorithm.
Classification belongs only to species, SMILES only to chemicals. Publication
is a supported future entity, not a new public search category. Column examples
are optional presentation values; absent/null examples show column placeholders.

Normal admin imports snapshot the latest published version before asynchronous
processing, persist its ID in `tables.metadata_version`, and use its worksheet
mappings instead of reading a workbook metadata sheet. Structured and raw JSON
editors modify the same document. Physical column types are text and text sets;
search, result placement, SMILES, references and classification are semantics,
not extra SQL types. Empty set choices are derived from imported values.

The editor lives at `/admin/metadata`; `/admin` only fetches the latest version
for uploads. Its draft previews project the sheets reachable from `main` into
search, observation results, entity panels, and classification. Preview values
are explicitly synthetic; previews must not publish, import, navigate to sample
links, or query active data as if it belonged to an unpublished definition.

Startup and scientific-data migration backfill historical dataset definitions
idempotently without rewriting scientific rows. Source catalogs can recover
original declarations and worksheet names, but not the order of multiple names
stored in a legacy set. Joined-only metadata is an incomplete, unpublished
archive: do not invent original worksheet mappings or keys. Preserve provenance
and raw declarations, and require completion before publication. Initially prefer
the active dataset's usable definition; never replace an admin-published latest
version during repeated backfill. Shared versions survive dataset deletion.

## Testing

Run tests through the root `Makefile`:

- `make lint` — Go vet plus frontend lint.
- `make test-unit` — backend unit/regression suite and frontend production build.
- `make test-backend-container` — CI-equivalent backend coverage/integration container.
- `make test-metadata` — PostgreSQL-only metadata versions, backfill, and HTTP
  persistence; requires an explicit disposable `TEST_POSTGRES_DSN`.
- `make test-entity-migration` — unjoined entities and real Cassandra/PostgreSQL
  migration tests; explicit disposable `TEST_POSTGRES_DSN` and
  `TEST_CASSANDRA_HOST` required, optional `TEST_CASSANDRA_PORT`.
- `make test-integration` — isolated Compose-backed auth/migration integration.
- `make test-e2e` — Playwright business journeys against the isolated stack.
- `make test` — complete gate.

Add regression coverage for every auth route or mutation-policy change. Browser
coverage must exercise behavior, not merely assert that management headings are
visible. Never add a TEST/AUTOTEST bypass around auth-master middleware.
