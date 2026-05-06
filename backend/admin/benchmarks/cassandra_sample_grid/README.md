# Cassandra sparse-read grid benchmark

Benchmarks **`BenchmarkCache_sample100_rows`**: read exactly **100** keys per timed iteration over tables of size **1000**, **100 000**, and **10 000 000** rows (step `N/100` across the partition). Each read uses **one CQL query** with `id IN (?, …)` (single round-trip). Row values are **512-byte blobs** (`v blob`) per row index (`admin/benchmarks/internal/payload`). Compares `WITH CACHING` policies on Cassandra only (no Redis).

## Prerequisites

- Go toolchain (`backend/admin` module root).
- Running **Apache Cassandra 3.11** (same steps as in [cassandra_vs_redis](../cassandra_vs_redis/README.md) §1).

## Run

From **`backend/admin`**:

```bash
go test -bench=BenchmarkCache_sample100_rows -run='^$' -v ./benchmarks/cassandra_sample_grid/ > .log
```

Or all benchmarks in this package:

```bash
CASSANDRA_HOST=127.0.0.1 go test -bench=. -run='^$' -v ./benchmarks/cassandra_sample_grid/ > .log
```

**Redis is not used**; `go test -bench=...` does not require Redis.

Large row counts (especially `rows_10000000`) need a long insert phase, enough Cassandra heap, and patience.
