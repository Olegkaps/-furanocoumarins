"""Deterministic HTTP source for pipeline smoke, never a production backend."""
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path == '/metrics':
            body = '''# TYPE http_requests_total counter
http_requests_total{service="fuco-backend",method="GET",path="/article/:id",status_code="200"} 20
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{service="fuco-backend",method="GET",path="/article/:id",status_code="200",le="0.1"} 10
http_request_duration_seconds_bucket{service="fuco-backend",method="GET",path="/article/:id",status_code="200",le="1"} 20
http_request_duration_seconds_bucket{service="fuco-backend",method="GET",path="/article/:id",status_code="200",le="+Inf"} 20
http_request_duration_seconds_count{service="fuco-backend",method="GET",path="/article/:id",status_code="200"} 20
http_request_duration_seconds_sum{service="fuco-backend",method="GET",path="/article/:id",status_code="200"} 2
# TYPE go_goroutines gauge
go_goroutines 8
'''
        else:
            body = 'ok\n'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; version=0.0.4')
        self.end_headers()
        self.wfile.write(body.encode())
HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
