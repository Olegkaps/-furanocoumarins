import { expect, test } from "@playwright/test";

test("admins can upload, copy, replace, and delete a shared image", async ({ page, context }) => {
  const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
  const image = { id: "11111111-1111-4111-8111-111111111111.png", name: "first.png", size: 68, url: "https://images.example.test/bucket/admin-images/11111111-1111-4111-8111-111111111111.png" };
  let images: typeof image[] = [];
  let deleteRequests = 0;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(value => { localStorage.setItem("auth-token", value); localStorage.setItem("auth-refresh-token", "mock-refresh-token"); }, token);
  await page.route("**/admin/images", async route => {
    if (route.request().resourceType() === "document") return route.continue();
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(images) });
    images = [{ ...image, name: "first.png" }]; return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(images[0]) });
  });
  await page.route("**/admin/images/*", async route => {
    if (route.request().method() === "PUT") { images = [{ ...image, name: "changed.png" }]; return route.fulfill({ contentType: "application/json", body: JSON.stringify(images[0]) }); }
    if (route.request().method() === "DELETE") { deleteRequests += 1; images = []; return route.fulfill({ status: 204 }); }
    return route.fallback();
  });
  await page.goto("/admin/images");
  await expect(page.locator(".nav-admin-group").getByLabel("Image library", { exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator(".image-library__heading input[type=file]").setInputFiles({ name: "first.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(page.getByText("first.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy direct link" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(image.url);
  await page.locator(".image-library__card input[type=file]").setInputFiles({ name: "changed.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(page.getByText("changed.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete this image?", { exact: true })).toBeVisible();
  expect(deleteRequests).toBe(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Delete this image?", { exact: true })).toHaveCount(0);
  expect(deleteRequests).toBe(0);
  await page.getByRole("button", { name: "Delete" }).click();
  const deleteRequest = page.waitForRequest(request => request.method() === "DELETE" && request.url().endsWith(`/admin/images/${image.id}`));
  await page.getByRole("button", { name: "Delete image" }).click();
  await deleteRequest;
  expect(deleteRequests).toBe(1);
  await expect(page.getByText("changed.png", { exact: true })).toHaveCount(0);
});

test("explains when the deployed backend does not have the image endpoint", async ({ page }) => {
  const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
  await page.addInitScript(value => { localStorage.setItem("auth-token", value); localStorage.setItem("auth-refresh-token", "mock-refresh-token"); }, token);
  await page.route("**/admin/images", route => {
    if (route.request().resourceType() === "document") return route.continue();
    return route.fulfill({ status: 404, contentType: "text/plain", body: "Cannot GET /admin/images" });
  });

  await page.goto("/admin/images");
  await expect(page.getByRole("status")).toContainText("Deploy or restart the backend");
});
