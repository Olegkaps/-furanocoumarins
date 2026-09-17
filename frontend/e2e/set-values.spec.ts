import { expect, test } from "@playwright/test";

for (const type of ["search set chemical", "search set[obsolete stale] chemical"]) {
  test(`set values come from the backend on home and results: ${type}`, async ({ page }) => {
    const metadata = [{ column: "radicals", show_name: "Chemical radicals", type }];
    const member = "O'Brien, methyl";
    let unavailable = false;
    await page.addInitScript(() => {
      for (const p of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${p}`, "done");
    });
    await page.route("**/metadata", route => route.fulfill({ json: { metadata } }));
    await page.route("**/search?*", route => route.fulfill({ json: { metadata, data: [] } }));
    await page.route("**/autocomplete?*", route => route.fulfill({ json: {
      suggestions: [{ column: "radicals", show_name: "Chemical radicals", value: member }],
    } }));
    await page.route("**/autocomplete/radicals?*", route => {
      expect(new URL(route.request().url()).searchParams.get("value")).toBe(unavailable ? "obsolete" : "O'Brin");
      return unavailable ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({ json: { values: [member] } });
    });
    await page.goto("/search");
    const home = page.getByRole("combobox");
    await home.fill("O'Brin");
    const option = page.getByRole("option");
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(member);
    await expect(option).toContainText("Chemical radicals");
    await option.click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("query")).toBe("radicals CONTAINS 'O''Brien, methyl'");
    const input = page.getByRole("combobox", { name: "Search query", exact: true });
    await input.fill("radicals ");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: "CONTAINS", exact: true }).click();
    await input.pressSequentially("O''Brin");
    await page.getByRole("option", { name: member, exact: true }).click();
    await expect(input).toHaveValue("radicals CONTAINS 'O''Brien, methyl' ");
    unavailable = true;
    const failure = page.waitForResponse(r => new URL(r.url()).pathname === "/autocomplete/radicals" && r.status() === 503);
    await input.fill("radicals CONTAINS 'obsolete");
    await failure;
    await expect(page.getByRole("option")).toHaveCount(0);
  });
}
