import { expect, test } from "@playwright/test";

test("backend exposes endpoint latency and Go runtime after browser traffic", async ({ page, request }) => {
  await page.goto("/");
  const response = await request.get("http://localhost:8081/auth/admin/users");
  expect(response.status()).toBe(401);
  const metrics = await request.get("http://localhost:8081/metrics");
  expect(metrics.ok()).toBeTruthy();
  const body = await metrics.text();
  expect(body).toContain('path="/auth/admin/users",service="fuco-backend",status_code="401"');
  expect(body).toContain("http_request_duration_seconds_bucket{");
  expect(body).toContain("go_goroutines ");
  expect(body).toContain("go_memstats_heap_alloc_bytes ");
});
