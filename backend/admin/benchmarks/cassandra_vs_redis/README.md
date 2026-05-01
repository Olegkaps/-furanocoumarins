# Cassandra vs Redis vs PostgreSQL cache benchmarks

Benchmarks compare Apache Cassandra `WITH CACHING` policies, a Redis baseline, and PostgreSQL with several table storage options—same row count (**8192**) and payload size (**512** bytes) for cold/warm full reads by primary key.

The sparse-read grid (100 keys, large tables) lives in [cassandra_sample_grid](../cassandra_sample_grid/README.md).

## Prerequisites

- Go toolchain (same module as `backend/admin`).
- [Podman](https://podman.io/) (or Docker) for local databases.

**Redis is required** whenever you pass `-bench` to this package: `TestMain` pings Redis before any benchmark runs. Cassandra must be running for the Cassandra benchmarks.

**PostgreSQL** benchmarks (`BenchmarkPostgres_*`) run only if **`POSTGRES_BENCH_DSN`** is set; otherwise they **skip**. Create a database user/database as needed and pass a libpq URL, e.g. `postgres://bench:bench@127.0.0.1:5432/bench?sslmode=disable`.

## PostgreSQL “caching” scenarios

PostgreSQL has **no** per-table row cache like Cassandra’s `WITH CACHING`. Rows sit in heap pages; pages are cached in **`shared_buffers`**. The sub-benchmarks vary:

| Name | Meaning |
|------|---------|
| `heap` | Normal logged table (baseline). |
| `unlogged` | `UNLOGGED TABLE` — skips WAL; different durability, often faster writes. |
| `fillfactor_50` | `WITH (fillfactor=50)` — more free space per page; sparser row packing and different buffer-cache footprint on PK lookups. |

## 1. Start Cassandra 3.11

Maps the CQL native protocol port to `localhost:9042`:

```bash
podman run -d --name cassandra-bench -p 9042:9042 cassandra:3.11.9
```

Wait until CQL accepts connections (first start is often 30–90 seconds). Repeat until the command succeeds with exit code 0:

```bash
podman exec cassandra-bench cqlsh -e 'DESCRIBE KEYSPACES'
```

## 2. Start Redis

Same image family as the main stack (`redis:latest` in `docker-compose.yaml`). Port `6379` matches the default `REDIS_ADDR` `127.0.0.1:6379`:

```bash
podman run -d --name redis-bench -p 6379:6379 redis:latest
```

Wait until Redis responds with `PONG`:

```bash
podman exec redis-bench redis-cli ping
```

## 3. Start PostgreSQL (optional but needed for Postgres benchmarks)

Example using the official image (adjust password / DB name to match `POSTGRES_BENCH_DSN`):

```bash
podman run -d --name postgres-bench \
  -e POSTGRES_USER=bench \
  -e POSTGRES_PASSWORD=bench \
  -e POSTGRES_DB=bench \
  -p 5432:5432 \
  postgres:16-alpine
```

Wait until SQL accepts connections:

```bash
podman exec postgres-bench pg_isready -U bench -d bench
```

Export DSN for benchmarks:

```bash
export POSTGRES_BENCH_DSN='postgres://bench:bench@127.0.0.1:5432/bench?sslmode=disable'
```

## 4. Run benchmarks

From the **`backend/admin`** directory (module root):

```bash
cd backend/admin
go test -bench=. -benchtime=2s -run='^$' -v ./benchmarks/cassandra_vs_redis/ > .log
```

With explicit hosts:

```bash
CASSANDRA_HOST=127.0.0.1 REDIS_ADDR=127.0.0.1:6379 \
  POSTGRES_BENCH_DSN='postgres://bench:bench@127.0.0.1:5432/bench?sslmode=disable' \
  go test -bench=. -benchtime=2s -run='^$' -v ./benchmarks/cassandra_vs_redis/ > .log
```

### Notes

- **Cold vs warm**: Cassandra/Postgres cold benchmarks time the first full read after insert; warm benchmarks prime once then measure repeated full scans. Redis cold mirrors Cassandra cold (writes outside the timer, 8192 sequential `GET`s inside the timer).
- **Without `-bench`**: `go test ./benchmarks/cassandra_vs_redis/` runs no tests and does not require Redis or Cassandra.

## 5. Stop containers

```bash
podman stop cassandra-bench && podman rm cassandra-bench
podman stop redis-bench && podman rm redis-bench
podman stop postgres-bench && podman rm postgres-bench
```
