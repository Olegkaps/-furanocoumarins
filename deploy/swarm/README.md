# Production deploy: Docker Swarm

Stack definition for the furanocoumarins platform on a single VM. It uses
Docker Swarm for health checks, rolling updates, secrets, and overlay
networking. `authd` and its dedicated PostgreSQL database are private services;
only nginx publishes host ports.

For local development, use [docker-compose.local.yaml](../../docker-compose.local.yaml).

## Prerequisites

- Docker Engine with Swarm mode
- TLS certificates on the host (`/etc/letsencrypt`, managed by Certbot)
- Environment files under `env/` (generate with `./cli init_env` from repo root)
- `monitoring/grafana.ini` (also created by `./cli init_env`)
- Backend and importer images built and pushed
- Immutable furanocoumarins backend, auth-master, importer, and PostgreSQL image
  digests
- A production SMTP relay

Set the non-secret deployment inputs. Every image variable must use an
immutable digest; tags and `latest` are rejected before the image can be used.
The deployment script validates the three persistent-service images, while the
one-shot import script independently validates its importer image.

```bash
export AUTH_MASTER_IMAGE='registry.example/auth-master@sha256:...'
export FURANO_IMPORT_IMAGE='registry.example/furan-import@sha256:...'
export FURANO_BACKEND_IMAGE='registry.example/furan-backend@sha256:...'
export AUTH_POSTGRES_IMAGE='postgres@sha256:...'
export AUTH_SMTP_HOST='smtp.example.test'
export AUTH_SMTP_PORT='587'
export AUTH_MAIL_FROM='auth@example.test'
```

Prepare these readable, non-empty files before initializing secrets:

- `AUTH_POSTGRES_USER_FILE`, `AUTH_POSTGRES_PASSWORD_FILE`, and
  `AUTH_POSTGRES_DB_FILE`: credentials for auth-master's dedicated database.
- `AUTH_DATABASE_URL_FILE`: the complete auth-master target PostgreSQL DSN. Its
  Swarm-network hostname must be `auth-postgres`, for example
  `postgres://USER:PASSWORD@auth-postgres:5432/DB?sslmode=disable`.
- `FURANO_SOURCE_DATABASE_URL_FILE`: the complete DSN for the existing
  furanocoumarins PostgreSQL database containing the legacy `users` table. Its
  Swarm-network hostname must be `postgres`, for example
  `postgres://USER:PASSWORD@postgres:5432/DB?sslmode=disable`.
- `FURANO_SUPERUSER_FILE`: exactly one selected legacy login or email.
- `AUTH_PASSWORD_HISTORY_KEY_FILE` and `AUTH_SIGNING_KEY_FILE`: independent
  production encryption keys.
- `AUTH_MAGIC_CALLBACK_URL_FILE` and `AUTH_INVITE_CALLBACK_URL_FILE`: exact
  external BrowserRouter routes `https://<frontend>/admit` and
  `https://<frontend>/register`, respectively. No fragments, query strings, or
  alternate paths are accepted. Each file must contain exactly one URL; a
  conventional final LF or CRLF is removed before the normalized bytes are
  stored in Docker. Embedded line endings, multiple lines, and NUL bytes fail
  secret initialization.
- `AUTH_SMTP_USER_FILE` and `AUTH_SMTP_PASSWORD_FILE`: SMTP credentials.

Set `ALLOW_ORIGIN` in `env/.env` to the single exact HTTPS SPA origin used by
both callback URLs, for example `https://frontend.example`. Wildcards, multiple
origins, paths, userinfo, HTTP origins, and callback-origin mismatches are
rejected because the browser uses credentialed requests and refresh cookies.
The non-secret validated origin is copied to a Docker secret label so ordinary
deployment can repeat this preflight without exposing the rest of `go_auth_env`.

The scripts receive only file paths and image digests. Secret contents are not
placed in service environment variables, commands, or image arguments.

## First-time setup

From the repository root:

```bash
# 1. Initialize Swarm (once per VM)
docker swarm init

# 2. Create env files and grafana.ini
./cli init_env

# 3. Edit env/.env for production (cloud S3, DOMAIN_PREF, etc.)

# 4. Export every *_FILE path listed above and create Docker secrets
chmod +x deploy/swarm/scripts/*.sh
./deploy/swarm/scripts/init-secrets.sh

# 5. Obtain TLS certificates (if not already present)
sudo certbot certonly --nginx -d 176.108.251.108.nip.io -d 176.108.251.108.sslip.io

# 6. Deploy the stack
./deploy/swarm/scripts/deploy.sh
```

The deployment fails before contacting Swarm when a persistent-service image is
not a digest, a callback secret is missing, or the SMTP host/from address is
absent. `run-auth-import.sh` applies the same fail-fast digest check to
`FURANO_IMPORT_IMAGE`.

On every `go-auth` start, the backend idempotently creates the Cassandra
`chemdb.table_activation` control table and migrates the single legacy
`is_active=true` registry row into its serialized active pointer before opening
the HTTP listener. This is the ordered upgrade step for existing clusters; no
separate manual CQL rollout is required. Startup is bounded and fails closed if
schema agreement fails or legacy data contains more than one active row. The
Cassandra principal used by `go-auth` therefore needs permission to create this
one table during the rollout.

{% note alert %}

This Swarm stack does not contain or serve the React frontend. Before creating
the callback secrets, deploy the existing SPA at the HTTPS origin used in both
files and configure its web server to fall back to `index.html` for the exact
BrowserRouter routes `/admit` and `/register`. Verify both URLs from outside the
cluster. Secret initialization validates their syntax and stores the expected
route in a non-secret Docker label; ordinary deployment rechecks those labels
and fails closed when either external route contract is absent or malformed.

{% endnote %}

## One-shot legacy identity import

Back up both PostgreSQL databases first. The existing `postgres` service is the
source of legacy identities; `auth-postgres` is the target. Do not copy legacy
password hashes.

Deploying authd first is mandatory: its exact image initializes and verifies
the target schema. After the stack is healthy and all migration secrets have
been created, run the separate side-owned importer image:

```bash
export FURANO_IMPORT_IMAGE='registry.example/furan-import@sha256:...'
./deploy/swarm/scripts/run-auth-import.sh
```

The script scales `go-auth` and `authd` to zero, waits until application writers
have stopped, then creates a non-restarting one-shot importer service from
`backend/admin/Dockerfile.importer`. The job
reads the source DSN, target DSN, and explicitly selected superuser through
Docker secret files. It restores the original replica counts on success,
failure, interruption, or timeout. Import failures are never retried
automatically.

After verifying the imported users, selected superuser, and passwordless login flow,
remove the migration-only secrets:

```bash
docker secret rm auth_source_database_url auth_selected_superuser
```

Neither secret is attached to the persistent stack. Recreate both explicitly
before an intentional idempotency check or migration rerun.

The importer uses a repeatable-read, read-only source transaction and an atomic
target transaction. Reruns are idempotent, but selected-superuser or source
fingerprint drift fails closed. Imported passwords remain unset unless the user
optionally completes forgot-password reset. Magic-link login can be repeated
indefinitely and grants normal role and superuser authority immediately.

## Verify deployment

```bash
docker stack ps furanocoumarins
docker service ls
docker service logs furanocoumarins_go-auth --tail 50
```

Services expose only nginx (ports 80/443) on the host. Grafana is available via the sslip.io domain configured in [configs/nginx.conf](configs/nginx.conf).

## Certificate renewal

Certbot runs on the host. After renewal, reload nginx in the stack:

```bash
sudo certbot renew
docker service update --force furanocoumarins_nginx
```

Example cron entry (`crontab -e`):

```cron
0 3 * * * certbot renew --quiet && docker service update --force furanocoumarins_nginx
```

## Secrets rotation

Docker secrets are immutable. To rotate:

```bash
docker secret rm go_auth_env   # only after removing from running stack
docker stack rm furanocoumarins
./deploy/swarm/scripts/init-secrets.sh
./deploy/swarm/scripts/deploy.sh
```

Or create new secrets with versioned names and update `stack.yaml` accordingly.

## Monitoring

Monitoring configs live in [monitoring/](../../monitoring/) and are bind-mounted into the stack:

- **Prometheus** — go-auth, nginx, PostgreSQL, Redis, Cassandra, VM (node-exporter), itself
- **Grafana** — dashboards in `monitoring/dashboards/` (Infrastructure overview, Nginx)
- **Loki + Promtail** — container logs (with `service` label for DBs) and host syslog from `/var/log`

Exporters: `postgres-exporter`, `redis-exporter`, `cassandra-exporter` (JMX), `node-exporter` (global, host mounts).

## Resource limits

CPU/memory limits in [stack.yaml](stack.yaml) are tuned for ~1 vCPU total. Adjust `deploy.resources.limits` if the VM is upgraded.

To disable Loki/Promtail and reduce load, comment out those services in `stack.yaml` before deploy.

## File layout

```
deploy/swarm/
├── stack.yaml           # production stack, including private authd services
├── configs/nginx.conf   # reverse proxy (Swarm service DNS)
└── scripts/
    ├── init-secrets.sh
    ├── deploy.sh
    └── run-auth-import.sh
```
