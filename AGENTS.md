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
`migrate-cassandra-postgres` command accepts `FURANO_CASSANDRA_HOST` and
`FURANO_POSTGRES_DSN`, or their `_FILE` variants. Swarm jobs can instead build
the target connection from `PG_HOST`, `PG_PORT`, `PG_SSLMODE` and mounted
`PG_USER_FILE`, `PG_PASSWORD_FILE`, `PG_DB_FILE` secrets. Never expose secret
values in logs or service arguments; ambiguous direct/file settings fail closed.
`make migration_1` builds `Dockerfile.migration` and runs a one-shot Swarm job
before deploying the PostgreSQL-only stack. The normal backend image excludes
the migration binary. The command reuses existing database networks and secrets,
stops `go-auth`, and leaves it stopped for cutover; it never deploys the stack or
removes Cassandra. Preserve the job's logs and inspect failures before retrying.
Read a quiesced legacy source, use an isolated target for
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

## Public Search Grammar

`backend/admin/internal/pkg/searchquery` owns expression parsing for both request
validation and PostgreSQL translation. Conditions use registered column names,
comparison operators and single-quoted values. AND binds more tightly than OR;
parentheses override precedence. Double apostrophes inside literals; never
interpolate literal values into SQL. Keep parser size, nesting and condition
limits when extending the grammar.

Query-line and comparison autocomplete share `frontend/src/SearchApp/QueryInput`
and its completion helper. Suggest registered columns, including classification
columns without the guided-form `search` marker. Operators must match physical
text/set behavior. Value requests must be debounced, bounded and discard stale
results. Keep query examples in the page-help tours aligned with the grammar.

## Publication Reader

`/admin/publication-reader` is an admin-only review workspace. Its three API
routes (`status`, `document`, `analyze`) all require `RequireAdmin`; Caddy forwards
only these exact endpoints, leaving the page route to the SPA. The implementation
lives in `backend/admin/internal/publicationreader`,
`frontend/src/Admin/PublicationReader*`, and
`frontend/src/Admin/browserPublicationAnalysis.ts`.

Documents are processed in memory and never change curated scientific records.
PDF extraction requires `pdftotext` (`poppler-utils` in the backend image); scanned
documents require external OCR. Text/HTML pagination is logical, not printed-page
pagination. URL imports must retain public-address-only, DNS-pinned fetching,
redirect validation, and bounded source/text sizes and deadlines.
PDF conversion has one shared process slot per backend instance; saturation
returns a retryable busy response instead of queuing more converter processes.

Browser analysis uses an admin-entered provider, model and personal API key.
Keep that key only in component memory, clear it when changing providers, and
never persist it, log it, put it in a URL, or send it through the application's
authenticated API client. Direct requests use fixed provider HTTPS endpoints,
omit cookies and application bearer tokens, and reject redirects. Browser
analysis must retain bounded responses, cancellation and exact evidence checks.
OpenRouter defaults to its free-only route; never silently fall back to paid
models. Other providers' free access depends on account tier, quota and region.
Document import and server configuration endpoints still require `RequireAdmin`.

Server-side analysis is disabled by default. The optional Yandex Cloud adapter requires
server-side `ALICE_API_ENABLED=true`, `ALICE_API_KEY`, and `ALICE_MODEL_URI`
(`gpt://<folder-id>/<model>/<version>`). Never expose this server key in frontend settings.
The free Alice consumer chat does not establish free API access; obtain explicit
provider selection before enabling billable requests. Imported publication text
is sent to the configured provider only when the admin requests analysis.

Findings are unverified AI candidates, with exact page quotations per reported
field. Quote matching is not semantic verification. Unreported chirality must not
be presented as absent chirality. Preserve these distinctions in the UI and tests.

The reader also accepts bounded local extraction JSON without calling a model:
`{document, analysis}` uses the normal page-based contracts; the offline preview's
`sections`/`findings` format is converted to logical pages. Optional exact
`mentions` and `association_note` preserve species-specific evidence and
cross-passage caveats. Pair selection controls highlights; clicked quotations
keep a distinct color after focus moves. Never infer species aliases from names.

`PublicationMainExport` builds unverified drafts from the latest published main
sheet's physical column order. CID lookup uses chemical names only; taxon lookup
uses genus/species only, never the chemical or publication. Keep ambiguity blank,
preserve manual selections/clears, and do not guess a reference ID from a URL.
Exports have matching HTML-table and TSV cells, including blanks, with a TSV
download fallback. Reviewing, importing extraction JSON, and copying must never
write curated data or automatically invoke an LLM. Extraction methods remain
review evidence, not automatically populated main-sheet fields.
Identity lookups request compact `/search` projections (`columns`, bounded
`limit`) rather than downloading complete joined observations. Keep the default
search response unchanged and never mutate cached rows while projecting them.
Truncated results must not produce automatic identity predictions.

## Testing

Run tests through the root `Makefile`:

- `make lint` — Go vet plus frontend lint.
- `make test-unit` — backend unit/regression suite and frontend production build.
- `make test-publication-reader` — reader/backend HTTP regressions, reader frontend
  tests, and frontend production build.
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
