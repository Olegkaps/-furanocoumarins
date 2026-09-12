# Local dev

Use this note as the quick-start path for a local development stack. The full
source remains [README.md](../../../README.md).

## First Setup

```bash
./cli init_env
```

Review generated files under `env/` and `monitoring/grafana.ini`.

Start the local infrastructure services:

```bash
docker compose -f docker-compose.local.yaml up -d postgres redis minio auth-postgres mailpit
```

The backend creates the `chemdb` schema on startup. Auth-master initializes its
own target schema when `authd` starts.

## Start The Stack

After initial setup, this is the normal local command:

```bash
docker compose -f docker-compose.local.yaml up -d
```

Useful local URLs:

- Backend API: `http://localhost:8081`
- MinIO console: `http://localhost:9001`
- Mailpit: `http://localhost:8025`

## Frontend

Install dependencies through the repository target:

```bash
make install
```

For the containerized frontend:

```bash
podman build --pull=always -t furanocoumarins-frontend ./frontend
podman run -p 5173:8080 furanocoumarins-frontend
```

For Vite development, use the frontend package scripts in
[frontend/package.json](../../../frontend/package.json).

## Checks

```bash
make lint
make test-unit
make test-e2e
```

Use `make test` for the complete gate when the change is ready.

## Notes

- Editable pages need S3-compatible storage; local dev uses MinIO.
- Public search, table, tree, history, and cache pages do not require login.
- Admin pages require [[Auth master|auth-master]] authentication and roles.
- Page-level help behavior is documented in [[Search UI#Help On Pages]].

## Related Notes

- [[Auth e2e]]
- [[Search UI]]
- [[Import pipeline]]
