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

## Testing

Run tests through the root `Makefile`:

- `make lint` — Go vet plus frontend lint.
- `make test-unit` — backend unit/regression suite and frontend production build.
- `make test-integration` — isolated Compose-backed auth/migration integration.
- `make test-e2e` — Playwright business journeys against the isolated stack.
- `make test` — complete gate.

Add regression coverage for every auth route or mutation-policy change. Browser
coverage must exercise behavior, not merely assert that management headings are
visible. Never add a TEST/AUTOTEST bypass around auth-master middleware.
