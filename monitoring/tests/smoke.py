import base64
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request


def get(url, auth=False):
    headers = {'Authorization': 'Basic ' + base64.b64encode(b'admin:fixture-local-only').decode()} if auth else {}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as response:
        return response.read()


def wait(check, label):
    error = None
    for _ in range(60):
        try:
            if check():
                print('PASS:', label, flush=True)
                return
        except Exception as exc:
            error = exc
        time.sleep(1)
    raise AssertionError(f'{label}: {error}')


def query(expr):
    payload = json.loads(get('http://prometheus:9090/api/v1/query?' + urllib.parse.urlencode({'query': expr})))
    assert payload['status'] == 'success', payload
    return payload['data']['result']

wait(lambda: json.loads(get('http://grafana:3000/api/health'))['database'] == 'ok', 'Grafana ready')
wait(lambda: get('http://nginx:8080/article/private-smoke-id?token=private-smoke-token'), 'nginx → fixture request')
for _ in range(5):
    get('http://nginx:8080/article/private-smoke-id?token=private-smoke-token')
    time.sleep(1)
for expr in ['nginx_http_response_count_total{route="/article/:id",status="200"}', 'nginx_http_response_time_seconds_hist_bucket{route="/article/:id"}', 'nginx_http_upstream_time_seconds_hist_bucket{route="/article/:id"}', 'http_requests_total{route="/article/:id",status="200"}', 'http_request_duration_seconds_bucket{route="/article/:id"}', 'go_goroutines{job="go-auth"}']:
    wait(lambda expr=expr: query(expr), expr)
# Non-proxied requests have their own bounded label and must not skew upstream quantiles.
get('http://nginx:8080/ping')
wait(lambda: query('nginx_http_response_count_total{route="/ping",proxied="false"}'), 'non-proxied nginx label')
assert not query('nginx_http_upstream_time_seconds_hist_count{route="/ping",proxied="true"}')
# Exporter must sum retry timings, preserving the quoted multi-upstream field.
message = '<190>Jan  1 00:00:00 smoke nginx: "GET /search HTTP/1.1" 200 0.050 "0.010, 0.020" /search go-auth true'
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
    sender.sendto(message.encode(), ('nginxlog-exporter', 8514))
wait(lambda: query('nginx_http_upstream_time_seconds_hist_sum{route="/search",proxied="true"}'), 'retry-list log parsed')
retry = query('nginx_http_upstream_time_seconds_hist_sum{route="/search",proxied="true"}')
assert abs(float(retry[0]['value'][1]) - 0.03) < 1e-8, retry
assert not query('nginx_parse_errors_total > 0')
series = get('http://prometheus:9090/api/v1/series?' + urllib.parse.urlencode({'match[]': '{__name__=~"nginx_.*|http_.*"}'})).decode()
assert 'private-smoke' not in series
try:
    get('http://nginx:8080/metrics')
    raise AssertionError('Public metrics exposed')
except urllib.error.HTTPError as exc:
    assert exc.code == 404
expected = json.load(open('/dashboard.json'))
actual = json.loads(get('http://grafana:3000/api/dashboards/uid/furanocoumarins-overview', True))['dashboard']
assert len(actual['panels']) == len(expected['panels'])
assert json.loads(get('http://grafana:3000/api/datasources/uid/prometheus/health', True))['status'] == 'OK'
for panel in expected['panels']:
    for target in panel['targets']:
        expr = target['expr'].replace('$__rate_interval', '1m').replace('$route', '.*').replace('$method', '.*')
        query(expr)  # Empty DB/VM results are expected in this HTTP pipeline fixture.
rules = json.loads(get('http://prometheus:9090/api/v1/rules'))['data']['groups']
assert all(r['health'] == 'ok' for g in rules for r in g['rules'])
assert len(json.loads(get('http://prometheus:9090/api/v1/alertmanagers'))['data']['activeAlertmanagers']) == 1
print('PASS: private route/query redaction; provisioned Grafana dashboard; every panel PromQL; alert evaluation/wiring')
