# auth-master integration

Furanocoumarins delegates identity, sessions, OTP, invitations, bans, and RBAC
to the private `authd` service. Browsers call only the fixed same-origin
`/auth/*` compatibility surface on `go-auth`; there is no arbitrary reverse
proxy and `authd` publishes no host port.

Authorization is fail-closed. Every data mutation requires the `admin` role.
Only a superuser can invite, ban, rotate signing keys, or grant/revoke `admin`.
An auth-master outage returns 503; an invalid token returns 401. A migrated user
with no password uses repeatable magic-link login and receives the same RBAC and
superuser authority as any other active user. Password reset remains optional.

## Offline migration

Back up both PostgreSQL databases and stop writes to the legacy `users` table.
Select the one account that must become superuser. The importer needs a DSN
that is valid inside the Compose network; credentials come from the existing
`env/postgres.env` file.

```sh
export AUTH_MASTER_CONTEXT=../auth-master
export FURANO_SUPERUSER=selected-login
export FURANO_SOURCE_DATABASE_URL='postgres://USER:PASSWORD@postgres:5432/DB?sslmode=disable'
make auth-import
```

The Make target starts authd first so that the exact deployed auth-master build
initializes its target schema, then stops `authd` and `go-auth`, runs the
furanocoumarins-owned importer image, and restores both writers even on failure.
Local Compose passes the source DSN and selector directly through the two
environment variables shown above; it does not mount `_FILE` paths. The
standalone importer supports `_FILE`, and the Swarm job uses that form because
Docker secrets are mounted as files.
The importer uses a read-only repeatable-read source transaction. It normalizes
mixed-case login/email values, rejects ambiguous identities, never selects or
copies password hashes, and atomically commits users, roles, memberships,
superuser authority, and a source-fingerprint audit. Verified reruns accept
passwords set after migration; selected-superuser or source drift fails closed.

After migration, each user can request a magic link and follow `/admit?token=…`
whenever they want to sign in; setting a password is never required. A user who
wants password login can use the normal forgot-password flow, while a user who
forgets an existing password uses the same flow.
Mailpit is available at port 8025 locally. `authd` and its PostgreSQL database
remain private on the Compose network; browsers use only the fixed `/auth/*`
BFF routes served by `go-auth`.

Install exact frontend/browser dependencies with `make install`, then run
`make test`. Individual gates are `test-unit`, `test-race`, `test-integration`,
and `test-e2e`. Existing domain/search UI remains unchanged; account security
adds sessions and superuser management.

## Production Swarm

Production uses the existing `postgres` service as the offline legacy-user
source and a separate private `auth-postgres` service as auth-master's target.
The application does not construct the legacy PostgreSQL user repository or
Redis magic-link store at runtime. PostgreSQL, S3, and the in-process search
cache remain unchanged.

Every credential, DSN, selected superuser, encryption key, and browser callback
URL is mounted from a Docker secret file. The operator sets one
`PUBLIC_APP_ORIGIN` in the ignored `deploy/swarm/production.conf`; secret
initialization derives the exact `/admit` and `/register` callback routes.
The Swarm stack has no frontend service, so those external BrowserRouter routes
must serve the existing SPA with history fallback. Deployment validates their
secret labels, HTTPS shape, paths, and origin consistency without probing them
through the external load balancer.
`ALLOW_ORIGIN` must equal that one HTTPS origin exactly; `*` and comma-separated
origin lists cannot carry credentialed refresh-cookie requests and are rejected.
The initializer derives database DSNs, generates auth database and encryption
credentials, and reads the existing protected mail value from `env/.env`; the
operator does not create callback or credential files. All four images in
`production.conf` must use either pinned digest references or explicit
non-`latest` version tags. Version-tag immutability is enforced by registry and
operator policy; only digest references are cryptographically pinned.

Follow [the Swarm deployment guide](../deploy/swarm/README.md) to create
secrets, deploy the private services, stop application writers, and execute the
non-restarting identity migration job. Never run the importer while `go-auth`
or `authd` can write identity data.

Delete the migration-only source DSN and selected-superuser secrets after the
import is verified. Persistent services never mount them; recreate them only
for an explicit rerun.
