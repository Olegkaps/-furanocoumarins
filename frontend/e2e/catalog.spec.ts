import { expect, test } from "@playwright/test";

test("publication catalog links are unavailable and never request catalog data", async ({ page }) => {
  const catalogRequests: string[] = [];
  await page.route("**/catalog/**", route => {
    catalogRequests.push(route.request().url());
    return route.fulfill({ status: 500, json: { error: "Unexpected catalog request" } });
  });
  await page.goto("/catalog?kind=publications");
  await expect(page.getByRole("heading", { name: "Catalog unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Publications", exact: true })).toHaveCount(0);
  expect(catalogRequests).toEqual([]);

  await page.route("**/catalog/chemicals?*", route => route.fulfill({ json: {
    kind: "chemicals", page_size: 24, primary_column: "cid", columns: [], items: [],
  } }));
  await page.route("**/catalog/chemicals/count?*", route => route.fulfill({ json: {
    kind: "chemicals", page_size: 24, total: 0, page_count: 0,
  } }));
  await page.getByRole("link", { name: "Browse chemicals and species" }).click();
  await expect(page.getByText("No records.", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Catalog type" }).getByRole("link")).toHaveCount(2);
});
