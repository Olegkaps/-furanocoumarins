import { expect, test } from "@playwright/test";

test("workbook combined fuzzy name selects matching observations", async ({ page }) => {
  test.skip(process.env.AUTOCOMPLETE_WORKBOOK_LIVE !== "1", "requires local workbook-backed site");
  await page.addInitScript(() => {
    for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.goto("/search");
  await page.locator("summary").filter({ hasText: /^Choose columns/ }).click();
  await page.getByRole("button", { name: "Clear columns", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Species / }).click();
  await page.getByRole("checkbox", { name: "genus + species", exact: true }).check();
  await page.getByRole("combobox").fill("angelca archang");
  const option = page.getByRole("option").filter({ hasText: /^Angelica archangelicagenus/ });
  await expect(option).toBeVisible();
  await option.click();
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/search" && new URL(r.url()).searchParams.has("q"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.data.length).toBeGreaterThan(0);
  for (const row of body.data) {
    expect(row.genus_original).toBe("Angelica");
    expect(row.species_original).toBe("archangelica");
  }
  await expect(page.getByRole("combobox", { name: "Search query", exact: true })).toHaveValue("(species_original = 'archangelica' AND genus_original = 'Angelica')");
  await page.screenshot({ path: test.info().outputPath("classification-results.png"), fullPage: true });
});

for (const operator of ["OR", "AND"]) {
test(`Heracleum selections honor ${operator} against actual observations`, async ({ page }) => {
  test.skip(process.env.AUTOCOMPLETE_WORKBOOK_LIVE !== "1", "requires local workbook-backed site");
  await page.addInitScript(() => {
    for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.goto("/search");
  await page.locator("summary").filter({ hasText: /^Choose columns/ }).click();
  await page.getByRole("button", { name: "Clear columns", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Species / }).click();
  await page.getByRole("checkbox", { name: "genus + species", exact: true }).check();
  const input = page.getByRole("combobox");
  const names: string[] = [];
  for (let index = 0; index < 2; index++) {
    await input.fill("Heracleum");
    const options = page.getByRole("option");
    await expect(options).not.toHaveCount(0);
    const labels = await options.locator("strong").allTextContents();
    expect(labels).not.toContain("Heracleum");
    expect(labels.length).toBeGreaterThan(1);
    const choice = options.filter({ hasText: /^Heracleum / }).nth(index);
    names.push(await choice.locator("strong").innerText());
    await choice.click();
  }
  expect(names[0]).not.toBe(names[1]);
  if (operator === "AND") await page.getByRole("radio", { name: "All (AND)", exact: true }).check();
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/search" && new URL(r.url()).searchParams.has("q"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  if (operator === "AND") {
    expect(body.data).toHaveLength(0);
    expect(new URL(page.url()).searchParams.get("query")).toContain(") AND (");
    return;
  }
  expect(body.data.length).toBeGreaterThan(0);
  const actual = new Set<string>();
  for (const row of body.data) {
    const full = `${row.genus_original} ${row.species_original}`;
    expect(names).toContain(full);
    actual.add(full);
  }
  expect([...actual].sort()).toEqual([...names].sort());
  expect(new URL(page.url()).searchParams.get("query")).toContain(") OR (");
});

}
