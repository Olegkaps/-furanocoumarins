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
not extra SQL types. Set autocomplete values come from stored rows through the backend, never from metadata choices. New imports store bare set declarations in runtime metadata; legacy choices remain readable in original declarations and immutable definitions.

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

The guided search also exposes a virtual genus + species autocomplete column.
It combines searchable classification ranks 0 and 1 only within the same tag,
using actual observation pairs. Suggestions carry physical-column conditions;
selection becomes a genus AND species expression. Generated suggestions contain full names; genus-only values belong to the ordinary genus column.
Guided search defaults to OR and offers an Any (OR) / All (AND) selector for combining selections and any remaining typed value. Keep each full-name pair grouped with AND and the typed value’s alternative columns grouped with OR.
The virtual identifier is autocomplete-only and must never enter the query grammar.

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


## Autocomplete search engine

`internal/autocomplete` embeds Bleve for case-insensitive token prefixes and
one-edit fuzzy value matching. The default and guided-search scope honors the
metadata `search` flag, with SMILES always eligible. Explicit result-query column
completion may still address any registered column.
Suggestions identify their column/show_name. The legacy chemical `names` column
stores an equals-delimited alias list: split only `=`, preserve chemical-name
commas, trim and deduplicate aliases. Its autocomplete values are individual
aliases; selecting one emits `names CONTAINS 'alias'`, with exact list membership
across every matching row. The shared metadata predicate scopes this scalar-list
exception to chemical names. Existing scalar `=` and scientific response cells
remain unchanged; native text sets keep their existing array membership.
Parsed bibliography fields enrich reference suggestions, which still insert the
reference ID into a normal search condition.

The active dataset and persisted bibliography generation identify a rebuildable
index. Recheck that identity before returning results; never serve suggestions
from a previously active dataset. Cold rebuilds are bounded and exclusive; warm
text searches can run concurrently. PostgreSQL remains the scientific source.

`internal/chemistry` calls native RDKit through cgo. Production and test images
use Debian and compile with the `rdkit` build tag. A build without native RDKit
must explicitly reject structure requests, never pretend text similarity is
substructure matching. Never case-fold SMILES. Relaxed atom matching preserves
explicit heteroatoms; relaxed bonds preserve double/triple/aromatic constraints.
Stereo matching is independently selectable. Limits and native scan concurrency
are part of the public endpoint's resource bounds. Native calls run in at most two
reusable local worker processes; kill and reap a timed-out worker before
replacing it. Do not call the uninterruptible native matcher in HTTP goroutines.

Structure requests screen against persistent PostgreSQL candidate fingerprints,
not Bleve entries. Schema initialization creates the version catalog, candidate
table, four GIN indexes and fallback index. First use starts a bounded atomic
background backfill and returns retryable Busy until publication; replicas
serialize builds with an advisory lock. Dataset deletion cascades to its index.
Scientific datasets are immutable: dataset version plus FingerprintVersion
identifies chemistry generations; bibliography edits must not invalidate them.

Four monotone fingerprint modes retain/erase element and bond labels. Bounded
one/two-anchor paths retain explicit heteroatom and multiple-bond requirements
even in relaxed modes. Path, cycle, degree, finer occurrence-count and fused-cycle
attachment features narrow candidates while ignoring stereo/local hydrogen counts;
the original RDKit matcher verifies those and every explicitly supplied atom or
bond constraint afterward. Wildcards or feature-budget overflow bypass screening.
Never truncate target features. Increment FingerprintVersion when semantics change.

Use disjoint SQL branches for screenable GIN candidates and unscreenable fallback;
an OR fallback can prevent GIN use. Stream candidates once through a read-only
repeatable-read cursor in bounded batches. Validate fingerprint generation inside
that snapshot. Native workers parse only candidate batches. Full result overflow
fails explicitly rather than silently truncating matches. Keep candidate-superset
oracle tests across all eight modes, restart/rollback tests and actual SQL plans.

SearchApp uses one input with grouped column filters and selected-condition chips.
Results QueryInput requests values only for its current column and preserves
server fuzzy ranking. Column groups start collapsed. Structure mode targets all
SMILES columns automatically. Ketcher and its template/copy controls live only
in the structure drawer; those actions must not write scientific data. SMILES columns remain eligible
without the legacy search marker. MoleculePreview uses a lazy local SMILES
renderer for visible suggestions, bounded to 1024 characters and 128 atoms.
Keep raw selectable text when depiction fails; never send SMILES to an external
renderer or load the full drawing editor for thumbnails.

The structure drawer fixes positive hydrogen counts on selected atoms through
Ketcher's undoable atom attributes. Preserve constraints through export and
reopening. Indigo drops normal SMILES H-count attributes and atom maps; the
bounded drawer serializer uses checked temporary isotope identities only in
conversion copies, restoring real isotope labels before applying/returning data.
Use layout on tagged SMILES import to retain stereochemical wedges. Missing,
duplicated, or incompatible constraint identities must fail export visibly.

`make test-autocomplete` exercises native modes and the compressed workbook oracle
in `internal/chemistry/testdata`. Keep source hash, row provenance, invalid input
classification and independent Python expectations when refreshing the fixture.
Browser coverage lives in the autocomplete specs; live coverage must exercise
an actual native backend and a disposable PostgreSQL dataset.


### Structure predicates in search results

`smiles SUBSTRUCTURE 'C1CCCCC1'` filters actual observation results. Optional
enabled parameters are serialized as `SUBSTRUCTURE[bonds,hetero,stereo]`;
omitted parameters are false, so the default is bare `SUBSTRUCTURE`. The legacy
full named-boolean form remains accepted. Parameter completion belongs inside
the results query dropdown; never add separate drawing or flag controls there.
Compact legacy display without changing quoted literals or comparison identities. Existing equality remains exact.
Only registered SMILES columns accept this operator. Resolve the complete set
of matched molecular values through the bounded native workers and bind it as
SQL array membership inside the boolean expression; never reuse a truncated
suggestion page or expand into an unbounded OR expression. Preserve AND/OR
precedence, the dataset identity, and request deadlines throughout resolution.

The UI calls the control "bond multiplicity". Relaxed matching permits a
six-membered single-bond carbon ring to match an aromatic six-membered ring;
explicit multiple bonds and heteroatoms stay required. Explicit bracket hydrogen
counts also stay required in every mode: `O[CH3]` fixes a methyl end, while
unmarked positions remain open. Preserve that H-count query when replacing
carbon predicates for heteroatom relaxation; do not introduce a second query
language for this existing SMILES notation. Heteroatom relaxation
must not add an aliphatic-only constraint that removes existing aromatic hits.
An eight-membered query is not a benzene query and must retain its topology.
