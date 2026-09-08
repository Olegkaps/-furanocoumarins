# Monitoring contracts

Read the root AGENTS.md and monitoring/README.md before changes. Run tests only
through make; `make test-monitoring` and `make test-monitoring-smoke` are the narrow
gates. Do not deploy production services as part of validation.

Preserve datasource UIDs `prometheus` and `loki`, dashboard UID
`furanocoumarins-overview`, unrelated Grafana settings and existing production
image policy. Do not silently downgrade images using persistent stores.

Keep nginx route/method labels bounded and exclude raw query strings, IDs,
tokens, headers and bodies from telemetry logs. Update the nginx map with backend
routes. Only `proxied="true"` enters upstream percentiles; keep the quoted retry
list format synchronized with the exporter and its smoke regression.

Go/Fiber exports on :80; Prometheus maps path/status_code to route/status.
Do not reintroduce duplicate :5000 scraping. Auth-master is private and its
metrics require the metrics network. Scrape Swarm tasks and alert for absent
jobs as well as `up == 0`.

Do not claim TCP probes establish database query readiness. Cassandra remote JMX
requires a separate authenticated setup; never disable authentication implicitly.
Keep missing JMX visible. State Linux host/namespace and OOM attribution limits.

Every new alert needs unhealthy and healthy/absence boundary rule fixtures.
Every dashboard expression must pass the live Prometheus smoke parser.
Alertmanager delivery remains inactive until a real receiver is configured;
never imply that existing Grafana SMTP automatically routes Prometheus alerts.
