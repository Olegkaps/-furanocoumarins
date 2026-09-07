# Furanocoumarins monitoring

The provisioned **Furanocoumarins — services and VM** dashboard appears in the
Furanocoumarins Grafana folder after the normal Swarm deployment. Its stable UID
is `furanocoumarins-overview`; it uses the existing `prometheus` datasource and
preserves the existing `loki` datasource. Changes in this directory are not a
production deployment. Existing Grafana/Prometheus image declarations are
preserved to avoid silently downgrading persistent stores; test images are pinned.

## What is measured

- Nginx endpoint request rates, status codes, and total/upstream p50, p95 and p99.
  `stub_status` supplies connection state; the separate nginxlog exporter reads
  bounded syslog records for request timing. Static/redirect responses are
  excluded from upstream percentiles. Retry timings are summed by the exporter.
- Go/Fiber BFF endpoint metrics plus Go/process collectors from `go-auth:80/metrics`.
  Prometheus renames the existing `path` and `status_code` labels to `route` and
  `status`. It no longer scrapes port 5000, avoiding duplicate runtime series.
- Private auth-master endpoint timing, requests in flight and Go/process metrics.
- Both application and auth-master PostgreSQL connection health, connection
  counts/utilization, database size, transactions, cache hits and deadlocks.
- Redis health, memory, clients, command rate, cache hit ratio and evictions.
- Cassandra CQL port 9042 TCP reachability and an explicit missing-JMX indicator.
- Linux VM CPU, memory, filesystem space/inodes, disk throughput and kernel OOM
  kills. Go process restarts, CPU, RSS, heap, allocations, goroutines and GC pauses.

Nginx labels are a finite map of registered routes. Query strings, IDs, auth
tokens, request bodies, cookies and client addresses are not included in the
metrics access log. Unknown paths and methods use `unmatched` and `OTHER`.
Add new backend routes to `nginx-metrics.conf`; the contract test detects omissions.
Syslog uses UDP on the private metrics network: exporter restarts or UDP loss can
lose observations, so nginx counters are best-effort telemetry, not an audit log.
Application `/metrics` remains privately scrapeable and is blocked at public nginx.

## Health and platform limits

HTTP `/ping`, `/healthz` and `/nginx-health` are liveness checks. Cassandra TCP
success means that a socket accepts connections; it does not authenticate or
execute CQL and does not establish query readiness. PostgreSQL and Redis
exporters separately check their database connections.

Cassandra 3.11's existing localhost-only JMX configuration is deliberately
unchanged. The corrected Criteo exporter uses its documented configuration file,
image and `cassandra_stats{name="..."}` metric schema. Detailed JVM/compaction and
latency panels remain empty, and `CassandraJMXUnavailable` fires, until operators
configure **authenticated remote JMX** and exporter credentials. Do not disable
JMX authentication to make a dashboard green. This task does not configure JMX
secrets or change the database's management interface.

Swarm task DNS discovery scrapes individual replicas; task IPs are the `instance`
identity and can change after rescheduling. Missing-target alerts cover services
with no discoverable tasks, including the case where the final replica disappears.
The current node-exporter is global, with host proc/sys/root mounts. Its network
throughput is explicitly labelled as the exporter network namespace, not physical
host NICs; reliable host NIC totals require a separately planned host-network
exporter setup. On Docker Desktop/Podman macOS, VM metrics describe the Linux
container VM, not macOS. Kernel OOM events are VM-wide and do not identify the
killed container. Container memory-limit OOMs need additional cgroup telemetry.

## Alerts and delivery

Prometheus evaluates endpoint 5xx and p95 latency, failed HTTP/TCP probes,
missing/failed scrape targets, PostgreSQL/Redis health, connection pressure,
deadlocks, Redis memory/evictions, VM OOM/disk/inode/memory/CPU pressure, backend
restarts and malformed nginx logs. Thresholds are starter values; adjust latency,
resource thresholds and durations to measured traffic and service objectives.

**External notifications are inactive.** Alertmanager has a `local-ui` receiver
without an email/chat/webhook destination. Configure a real receiver and its
secret before expecting notifications. Existing Grafana SMTP settings do not
activate Prometheus/Alertmanager delivery. Alertmanager is private, and the
Grafana firing-alert panel exposes the active rule state.

## Validation

Run all validation through the root Makefile:

```bash
make test-monitoring
make test-monitoring-smoke
```

`test-monitoring` runs backend telemetry regressions, dependency-free Python
contract checks, Prometheus configuration/rule fixtures, nginxlog configuration
validation and Alertmanager configuration validation. The rules include healthy,
pending, sustained-failure, absent-target, readonly filesystem and pseudo-filesystem
cases. `make test` includes the configuration and pipeline smoke gates.

The smoke starts a uniquely named temporary Compose project with real nginx,
nginxlog exporter, Prometheus, Grafana and Alertmanager plus a deterministic HTTP
metrics fixture. It checks endpoint normalization, token/ID omission, upstream
retry lists, non-proxied exclusion, every dashboard PromQL expression, Grafana
provisioning/datasource health and alert evaluation/wiring. It removes only its
own containers and volumes. It has no production secrets, host mounts or public
ports. Synthetic DB/VM data is not supplied; empty DB/VM results are expected.
The application E2E suite separately tests real Go/Fiber telemetry behavior.

This smoke does not validate a production Swarm deployment, Cassandra JMX,
physical VM metrics, real database exporter versions or notification delivery.
Those require post-deployment acceptance checks on the intended environment.

## Verified upstream contracts

- [nginxlog exporter metrics and relabel configuration](https://github.com/martin-helmich/prometheus-nginxlog-exporter/tree/v1.11.0)
- [nginxlog multi-upstream parsing](https://github.com/martin-helmich/prometheus-nginxlog-exporter/blob/v1.11.0/main.go)
- [Criteo Cassandra exporter configuration and metric schema](https://github.com/criteo/cassandra_exporter)
- [Criteo image version and filesystem paths](https://github.com/criteo/cassandra_exporter/blob/master/docker/Dockerfile)
- [Criteo supported environment overrides](https://github.com/criteo/cassandra_exporter/blob/master/docker/run.sh)
