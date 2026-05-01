# Cassandra / Redis cache benchmarks

Benchmarks compare Apache Cassandra `WITH CACHING` policies and a Redis baseline with the same row count and payload size for cold reads.

## Prerequisites

- Go toolchain (same module as `backend/admin`).
- [Podman](https://podman.io/) (or Docker) for local databases.

**Redis is required** whenever you pass `-bench` to this package: `TestMain` pings Redis before any benchmark runs. Cassandra must be running for the Cassandra benchmarks.

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

## 3. Run benchmarks

From the **`backend/admin`** directory (module root):

```bash
cd backend/admin
go test -bench=. -benchtime=2s -run='^$' -v ./benchmarks/cassandra_vs_redis/ > .log
```

With explicit hosts:

```bash
CASSANDRA_HOST=127.0.0.1 REDIS_ADDR=127.0.0.1:6379 \
  go test -bench=. -benchtime=2s -run='^$' -v ./benchmarks/cassandra_vs_redis/
```

### Notes

- **Cold vs warm**: Cassandra cold benchmarks time the first full read after insert; warm benchmarks prime once then measure repeated full scans. Redis cold mirrors Cassandra cold (writes outside the timer, 8192 sequential `GET`s inside the timer).
- **Without `-bench`**: `go test ./benchmarks/cassandra_vs_redis/` runs no tests and does not require Redis or Cassandra.

## 4. Stop containers

```bash
podman stop cassandra-bench && podman rm cassandra-bench
podman stop redis-bench && podman rm redis-bench
```
