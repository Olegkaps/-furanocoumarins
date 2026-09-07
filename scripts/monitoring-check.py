#!/usr/bin/env python3
"""Validate dashboard/route/scrape contracts; invoke only through make."""
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
nginx = (root / 'monitoring/nginx-metrics.conf').read_text()
router = (root / 'backend/admin/internal/presentation/http/router.go').read_text()
for group, route in re.findall(r'(app|super)\.(?:Get|Post|Delete|Put|Patch)\("([^"]+)"', router):
    route = ('/auth/admin' if group == 'super' else '') + route
    assert route in nginx, f'Missing normalized nginx route {route}'
log = re.search(r"log_format monitoring '(.*?)';", nginx, re.S)[1]
for unsafe in ('$uri', '$args', '$http_', '$request_body', '$remote_addr', '$request_uri'):
    assert unsafe not in log, f'Private field {unsafe} in logs'
assert 'default unmatched;' in nginx and 'default OTHER;' in nginx
config = (root / 'monitoring/prometheus.yml').read_text()
assert '5000' not in config
for job in ('go-auth', 'authd', 'auth-postgres', 'postgres', 'redis', 'cassandra', 'nginx', 'nginxlog', 'node'):
    assert f'job_name: {job}\n' in config, job
stack = (root / 'deploy/swarm/stack.yaml').read_text()
authd = stack.split('\n  authd:\n')[1].split('\n  redis:\n')[0]
assert '      - metrics\n' in authd and '    ports:' not in authd
assert 'LOCAL_JMX' not in stack, 'Do not change Cassandra JMX authentication implicitly'
assert 'location = /metrics { return 404; }' in (root / 'deploy/swarm/configs/nginx.conf').read_text()
dashboard = json.loads((root / 'monitoring/dashboards/furanocoumarins.json').read_text())
assert len({p['id'] for p in dashboard['panels']}) == len(dashboard['panels'])
expressions = [t['expr'] for p in dashboard['panels'] for t in p['targets']]
for metric in ('http_request_duration_seconds_bucket', 'auth_http_request_duration_seconds_bucket', 'nginx_http_response_time_seconds_hist_bucket', 'nginx_http_upstream_time_seconds_hist_bucket', 'go_goroutines', 'redis_up', 'cassandra_stats', 'node_vmstat_oom_kill'):
    assert any(metric in expr for expr in expressions), metric
assert all(p['datasource']['uid'] == 'prometheus' for p in dashboard['panels'])
rules = re.findall(r'^  - alert: (.+)$', (root / 'monitoring/alerts.yml').read_text(), re.M)
# Alerts are indented differently across YAML formatters; use flexible indentation.
rules = re.findall(r'^\s*- alert: (.+)$', (root / 'monitoring/alerts.yml').read_text(), re.M)
fixture_names = re.findall(r'^\s*alertname: (.+)$', (root / 'monitoring/tests/alerts.test.yml').read_text(), re.M)
assert set(rules) == set(fixture_names)
print(f'PASS: route privacy and wiring, {len(dashboard["panels"])} panels, {len(rules)} alert rules')
