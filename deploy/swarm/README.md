# Production deploy: Docker Swarm

Stack definition for the furanocoumarins platform on a single VM (2×0.5 vCPU). Uses Docker Swarm for healthchecks, rolling updates, secrets, and overlay networking.

For local development, use [docker-compose.local.yaml](../../docker-compose.local.yaml).

## Prerequisites

- Docker Engine with Swarm mode
- TLS certificates on the host (`/etc/letsencrypt`, managed by Certbot)
- Environment files under `env/` (generate with `./cli init_env` from repo root)
- `monitoring/grafana.ini` (also created by `./cli init_env`)
- Backend image built and pushed, or use the default `olegkaps/chem-admin:1.1`

Build a custom backend image:

```bash
docker build -t olegkaps/chem-admin:1.1 ./backend/admin
export GO_AUTH_IMAGE=olegkaps/chem-admin:1.1
```

## First-time setup

From the repository root:

```bash
# 1. Initialize Swarm (once per VM)
docker swarm init

# 2. Create env files and grafana.ini
./cli init_env

# 3. Edit env/.env for production (cloud S3, DOMAIN_PREF, etc.)

# 4. Create Docker secrets from env/
chmod +x deploy/swarm/scripts/*.sh
./deploy/swarm/scripts/init-secrets.sh

# 5. Obtain TLS certificates (if not already present)
sudo certbot certonly --nginx -d 176.108.251.108.nip.io -d 176.108.251.108.sslip.io

# 6. Deploy the stack
./deploy/swarm/scripts/deploy.sh
```

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

- **Prometheus** — scrapes go-auth (Fiber + native metrics), nginx-exporter, itself
- **Grafana** — dashboards and datasources from `monitoring/dashboards/`
- **Loki + Promtail** — container log aggregation via Docker socket

Nginx metrics are collected via `nginx-exporter` scraping `stub_status` on the internal port 8080.

## Resource limits

CPU/memory limits in [stack.yaml](stack.yaml) are tuned for ~1 vCPU total. Adjust `deploy.resources.limits` if the VM is upgraded.

To disable Loki/Promtail and reduce load, comment out those services in `stack.yaml` before deploy.

## File layout

```
deploy/swarm/
├── stack.yaml           # production stack
├── configs/nginx.conf   # reverse proxy (Swarm service DNS)
└── scripts/
    ├── init-secrets.sh
    └── deploy.sh
```
