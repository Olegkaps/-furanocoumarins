# Furanocoumarins Analysis Platform

A web‑based platform for analyzing the content of furanocoumarins and other substances in plants.
It allows you to download data from Google Tables, build phylogenetic trees and analyze the distribution of substances by taxanomy.

Below is an example of the site's UI (home page): search bar, phylogenetic tree, and results table.

![app ui (tree)](./img/fuco_ui.png)
![app ui (table)](./img/fuco_ui_1.png)

Which data will be displayed on the website is completely determined by the administrator through the settings in the Google Sheet, as shown below. Using the __LIST__ type, a list of sheets that contain data of the same type is registered, and all columns that will be displayed on the website are specified for them

![settings in Google sheets](./img/fuco_sheets.png)

## Key features

- **Importing data**: downloading data from Google Tables.
- **Data analysis**: filtering by conditions with visualization of results.
- **Phylogenetic trees**: automatic construction of a tree indicating the number of finds for each taxonomic group.
- **The results are in the table**: final table with filtered data.
- **Admin panel**: database content management (adding, editing, deleting records).

## Technology stack

**Backend**:
- Language: Go.
- Containerization: Docker.
- Database of administrators: PostgreSQL + Redis.
- Table data storage: Apache Cassandra.
- Object storage: S3-compatible storage (MinIO in dev) for editable page content (About, substance descriptions).
- UI library for Cassandra: Netflix Data Explorer.
- Authorization: JWT.

**The frontend**:
- React + Vite + TypeScript.

## Project Launch

### 1. Preparing the backend

Set environment variables in `env/.env` (and related files under `env/` as needed). See [Environment variables](#environment-variables) below.

**Compose files:**
- **docker-compose.yaml** — main stack: go-auth, PostgreSQL, Redis, Cassandra; optionally monitoring (Prometheus, Grafana, Loki, Promtail).
- **docker-compose.local.yaml** — same plus **MinIO** (S3-compatible storage) for editable pages (About, substance descriptions by SMILES). Use this localy.

Launch the services:

```bash
docker compose up -d
```

Or, for the local variant with MinIO (editable pages):

```bash
docker compose -f docker-compose.local.yaml up -d
```

### 2. Database initialization

After the first launch of the backend, build the CLI and run init in this order (keyspace first, then tables):

- Build CLI binary:
  ```bash
  go build cli/main.go -o cli
  ```

- Database initialization (order matters: create keyspace, then tables):
  ```bash
  ./cli init postgresql
  ./cli init cass_key    # Cassandra keyspace chemdb
  ./cli init cassandra   # Tables including chemdb.pages (for About and substance pages)
  ```

- Creating administrator accounts:
  ```bash
  ./cli create_admin <username> <email>
  ```

- Run tests:
  ```bash
  cd backend/admin & go test -v ./...
  ```
  or inside container
  ```bash
  docker build backend/admin --file Dockerfile.test --build-arg VAR=$(date +%s)
  ```

### 3. Launching the frontend
1. Build a Docker image:
   ```bash
   docker build -t furanocoumarins-frontend .
   ```

2. Run container
   ```bash
   docker run furanocoumarins-frontend
   ```

## S3 / MinIO (object storage)

Editable page content (About page, substance descriptions by SMILES at `/page/:smiles`) is stored in S3-compatible object storage. The backend serves content from S3 and writes to it when an admin saves changes.

- **Local/dev:** use **MinIO** via `docker-compose.local.yaml` (service `minio`). The bucket is created automatically on first save.
- **Production:** configure the backend to use your S3 endpoint and credentials.

Without S3 (or with empty `S3_ENDPOINT`), editable pages will not work. For full functionality use either `docker-compose.local.yaml` with MinIO or an external S3.

Backend environment variables for go-auth (see `backend/admin/settings/settings.go`):

- `S3_ENDPOINT` — e.g. `http://minio:9000`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET` — e.g. `pages`
- `S3_REGION`, `S3_USE_PATH_STYLE` (optional)

## Monitoring

The stack can include optional monitoring services (defined in `docker-compose.yaml`):

- **Prometheus** (port 9090) — metrics; config: [monitoring/prometheus.yml](monitoring/prometheus.yml)
- **Grafana** (port 3000) — dashboards and datasources under [monitoring/](monitoring/)
- **Loki** (port 3100), **Promtail** (port 9080) — log aggregation

Config files live in the [monitoring/](monitoring/) directory. Start the stack with the compose file that includes these services to use them; Grafana can be opened at `http://localhost:3000` with pre-provisioned Prometheus datasource.

## Environment variables

Main backend (go-auth) variables are loaded from `env/.env` (and related files under `env/`). You need:

**Backend (go-auth):**
- PostgreSQL: `PG_USER`, `PG_PASSWORD`, `PG_DB`
- Redis: `REDIS_ADDR`, `REDIS_PASSWORD`
- Cassandra: `CASSANDRA_HOST`
- JWT: `SECRET_KEY`
- CORS: `ALLOW_ORIGIN`
- Links in emails: `DOMAIN_PREF`
- S3 (for editable pages): `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`; optionally `S3_REGION`, `S3_USE_PATH_STYLE`
- SMTP and other app settings as used in the compose/env files

**Frontend:**
- `VITE_REACT_APP_BACKEND_SOURCE` — backend API base URL (used as `BASE_URL` in [frontend/src/config.tsx](frontend/src/config.tsx)). Must be set at build/run time for the frontend to call the API.

## Admin Panel

Accessible via a secure route (JWT required). It allows:

- Managing records in the database.
- Import/export of data.
- Editing page content stored in S3: the About page and substance descriptions (by SMILES).

## License
[TO DO: MIT]
