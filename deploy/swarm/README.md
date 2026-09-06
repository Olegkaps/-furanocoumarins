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
- Pushed images for the furanocoumarins backend and importer, auth-master, and
  PostgreSQL, each using a pinned digest or explicit non-latest version tag
- A production SMTP relay

## One production configuration file

```bash
cp deploy/swarm/production.conf.example deploy/swarm/production.conf
nano deploy/swarm/production.conf
```

This ignored file is the only deployment-specific input read by all
production commands. Do not write `export`, shell quotes, or shell expressions in it. Put
the public SPA origin, four pinned image references, SMTP address, and selected
legacy superuser in this file. Each image may use a `repository@sha256:...`
digest or an explicit non-`latest` version tag. Treating a version tag as
immutable is an operator and registry policy; only a digest is cryptographically
pinned. Floating `latest`, untagged images, and malformed references are rejected.
This changes deployment preflight only; fake-Docker shell tests cover the policy,
while application integration and browser behavior are unaffected.

The callback URLs are derived automatically as
`PUBLIC_APP_ORIGIN/admit` and `PUBLIC_APP_ORIGIN/register`; do not create
callback files. The initializer also:

- reads the existing PostgreSQL and Redis credentials from `env/*.env`;
- derives the legacy source DSN using the Swarm service name `postgres`;
- generates the auth-master database password and both encryption keys;
- forces `ALLOW_ORIGIN`, `DOMAIN_PREF`, and `ENV_TYPE=PROD` in the protected
  `go_auth_env` Docker secret;
- reads the SMTP password from `AUTH_SMTP_PASSWORD` or `MAIL_SECRET` in the
  already ignored `env/.env`.

No secret value is passed in an environment variable or command line. Docker
stores generated values directly from temporary mode-private files, which are
removed when initialization exits.

## First production deployment

After cloning the repository, run this block from its root. These commands do
not require any exported deployment variables or hand-made secret files.

```bash
docker swarm init
go build -o cli ./cli
./cli init_env
cp deploy/swarm/production.conf.example deploy/swarm/production.conf
nano deploy/swarm/production.conf
nano env/.env
nano deploy/swarm/configs/nginx.conf

# Obtain TLS certificates for the API and Grafana hosts in nginx.conf.
sudo certbot certonly --standalone -d api.furan.example.com -d grafana.furan.example.com

./deploy/swarm/scripts/init-secrets.sh
./deploy/swarm/scripts/migrate-cassandra-volume.sh
./deploy/swarm/scripts/deploy.sh

# Run once after the first stack deploy to move legacy identities.
./deploy/swarm/scripts/run-auth-import.sh

docker stack ps furanocoumarins
docker service ls
```

`PUBLIC_APP_ORIGIN` is the separately hosted React SPA. The nginx configuration
uses the API and Grafana hosts instead; replace both example certificate names
with those nginx hosts. In `env/.env`, configure the production S3 and domain
mail values and set `MAIL_SECRET` (or add `AUTH_SMTP_PASSWORD`). The
initializer is idempotent: it reports existing secrets instead of replacing
them. Rotation is always explicit.

The deployment fails before contacting Swarm when the config is missing, an
image lacks a pinned digest or explicit non-latest version tag, a callback secret does not match the configured
SPA origin, or SMTP settings are absent. After `docker stack deploy`, the script
waits for local `authd` and `go-auth` health checks, so the following import
command cannot race auth-master schema initialization on the documented
single-VM Swarm.

On every `go-auth` start, the backend idempotently creates the Cassandra
`chemdb.table_activation` control table and migrates the single legacy
`is_active=true` registry row into its serialized active pointer before opening
the HTTP listener. This is the ordered upgrade step for existing clusters; no
separate manual CQL rollout is required. Startup is bounded and fails closed if
schema agreement fails or legacy data contains more than one active row. The
Cassandra principal used by `go-auth` therefore needs permission to create this
one table during the rollout.

## One-shot legacy Cassandra cutover

Run the Cassandra migration after secret initialization and before the first
Swarm deploy:

```bash
./deploy/swarm/scripts/migrate-cassandra-volume.sh
```

This is an offline physical migration on the documented single Docker host. It
finds the actual legacy Cassandra container from the source volume and the
running `go-auth` writer from the container's Compose project labels. It then
stops the writer, runs `nodetool drain`, stops Cassandra, and uses the unchanged
`cassandra:3.11.9` image to copy the entire volume—not only the currently known
`chemdb` tables—to a distinct Swarm-owned volume. The script does not read or
execute `docker-compose.local.yaml`, whose current services may differ from the
legacy deployment. It compares sorted filesystem metadata and SHA-256 checksums
for every regular file before writing a completion marker. Commit logs, saved
caches, hints, system keyspaces, schema, indexes, dynamically created data tables,
and application keyspaces therefore move together.

The default source is `furanocoumarins_cassandra3_data`; the default target is
`furanocoumarins_swarm_cassandra3_data`. If the legacy Compose project used a
different project name, add its actual source volume once to the same ignored
configuration file:

```text
LEGACY_CASSANDRA_VOLUME=actual_compose_cassandra3_data
```

No environment export or legacy Compose file is needed. On copy or verification
failure, the script removes only the partial target it created and directly
restarts whichever legacy containers it stopped. On success it keeps the source
volume stopped and untouched for rollback; remove that source only after
application-level verification and a separate backup.

`deploy.sh` mounts only the explicit target volume. It refuses to deploy when
the target has not been prepared, and rejects migrated volumes without the
source label and completed checksum marker. It continues to use
`cassandra:3.11.9` for both marker validation and the Swarm service. Only a
confirmed installation with no legacy Cassandra data may create an empty
labeled volume using `./deploy/swarm/scripts/deploy.sh --fresh-cassandra`; that
flag still fails if the configured legacy source exists.

The fake-Docker regression test covers the fixed image, drain/stop/copy
ordering, idempotency, failure cleanup, and legacy-container restoration.
Compose rendering verifies the external-volume wiring. A
browser-only E2E cannot exercise a host-volume cutover; the existing
live-Cassandra import/search journey verifies the migrated data at the
application layer, while the final production copy remains an operator-run
maintenance step.

{% note alert %}

This Swarm stack does not contain or serve the React frontend. Before deploying
the backend stack, deploy the existing SPA at `PUBLIC_APP_ORIGIN` and configure
its web server to fall back to `index.html` for the exact
BrowserRouter routes `/admit` and `/register`. Verify both URLs from outside the
cluster. Secret initialization derives and validates the two routes; deployment
rechecks their labels and HTTP reachability before changing the stack.

{% endnote %}

## One-shot legacy identity import

Back up both PostgreSQL databases first. The existing `postgres` service is the
source of legacy identities; `auth-postgres` is the target. Do not copy legacy
password hashes.

Deploying authd first is mandatory: its exact image initializes and verifies
the target schema. After the stack is healthy, run the side-owned importer. It
reads its image and stack name from `production.conf`:

```bash
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
docker stack rm furanocoumarins
# Wait until `docker stack ps furanocoumarins` reports no stack.
docker secret rm go_auth_env
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
├── production.conf.example # copy to ignored production.conf and edit once
├── configs/nginx.conf   # reverse proxy (Swarm service DNS)
└── scripts/
    ├── production-config.sh
    ├── init-secrets.sh
    ├── migrate-cassandra-volume.sh
    ├── deploy.sh
    └── run-auth-import.sh
```
