# Production deploy

Production runs the backend stack on Docker Swarm. The React SPA is hosted
separately at `PUBLIC_APP_ORIGIN`; the Swarm stack serves API, private
auth-master services, PostgreSQL, Redis, S3 integration, nginx, and monitoring.

The full deployment guide is
[deploy/swarm/README.md](../../../deploy/swarm/README.md).

## Prerequisites

- Docker Engine with Swarm mode.
- TLS certificates on the host.
- Generated `env/` files from `./cli init_env`.
- `monitoring/grafana.ini`.
- Pushed images with pinned digests or explicit non-`latest` version tags.
- Production SMTP.
- A separately deployed SPA with BrowserRouter fallback for `/admit` and
  `/register`.

## Configuration

```bash
cp deploy/swarm/production.conf.example deploy/swarm/production.conf
nano deploy/swarm/production.conf
nano env/.env
nano deploy/swarm/configs/nginx.conf
```

Do not export deployment variables by hand. Production scripts read the ignored
`production.conf` file and generated Docker secrets.

## Deploy

```bash
docker swarm init
go build -o cli ./cli
./cli init_env
./deploy/swarm/scripts/init-secrets.sh
./deploy/swarm/scripts/deploy.sh
docker stack ps furanocoumarins
docker service ls
```

Identity import is intentionally not expanded here; use the authoritative
auth-master guide when a first deployment requires it.

## Verify

```bash
docker stack ps furanocoumarins
docker service ls
docker service logs furanocoumarins_go-auth --tail 50
```

Confirm externally:

- API host responds through nginx.
- Grafana host responds through nginx.
- The separately hosted SPA serves `/admit` and `/register` with history
  fallback.
- `ALLOW_ORIGIN` matches `PUBLIC_APP_ORIGIN`.

## Rotation And Renewal

TLS renewal:

```bash
sudo certbot renew
docker service update --force furanocoumarins_nginx
```

Secret rotation requires recreating the relevant Docker secret and redeploying
the stack. See the full Swarm guide before rotating production secrets.

## Related Notes

- [[Auth master]]
- [[Auth e2e]]
- [[Local dev]]
