import { expect, test } from "@playwright/test";

test("real indexed database supports fuzzy text, publication text and native substructure matching", async ({
  page,
}) => {
  test.skip(
    process.env.AUTOCOMPLETE_LIVE !== "1",
    "requires the disposable live autocomplete fixture",
  );
  await page.addInitScript(() => {
    for (const name of ["search", "table"])
      localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await input.fill("Angelca");
  await expect(
    page.getByRole("option").filter({ hasText: "Angelica archangelica" }),
  ).toBeVisible();
  await input.fill("Phototoxic coumarin chemistry");
  await expect(
    page.getByRole("option").filter({ hasText: "paper1" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "SMILES substructure", exact: true })
    .click();
  await input.fill("C1=CC(=O)OC2=CC3=C(C=CO3)C=C21");
  await expect(page.getByRole("option")).not.toHaveCount(0);
  await input.fill("C1CCCCC1");
  await expect(
    page.getByRole("option").filter({ hasText: "C1CCCCC1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option").filter({ hasText: "C1CCNCC1" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Allow carbon to match heteroatoms" })
    .check();
  await input.focus();
  await expect(
    page.getByRole("option").filter({ hasText: "C1CCNCC1" }),
  ).toBeVisible();
  await input.fill("CC");
  await page.getByRole("checkbox", { name: "Match bond multiplicity" }).uncheck();
  await input.focus();
  await expect(
    page.getByRole("option").filter({ hasText: /^C=C/ }),
  ).toBeVisible();
  await input.fill("C=C");
  await expect(
    page.getByRole("option").filter({ hasText: /^CCStructure/ }),
  ).toHaveCount(0);
});

test("workbook data: six-member skeleton searches full observations; eight-member ring does not", async ({ page }) => {
  test.skip(process.env.AUTOCOMPLETE_WORKBOOK_LIVE !== "1", "requires local workbook-backed site");
  await page.addInitScript(() => { for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done"); });
  await page.goto("/search");
  await page.getByRole("button", { name: "SMILES substructure", exact: true }).click();
  const input = page.getByRole("combobox");
  await expect(page.getByRole("checkbox", { name: "Match bond multiplicity" })).not.toBeChecked();
  await input.fill("C1CCCCCCC1");
  await expect(page.getByText("No matching values.", { exact: true })).toBeVisible();
  await input.fill("C1CCCCC1");
  await expect(page.getByRole("option")).not.toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("search-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath("search-mobile.png"), fullPage: true });
  const results = page.waitForResponse(response => new URL(response.url()).pathname === "/search" && new URL(response.url()).searchParams.has("q"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const response = await results;
  expect(response.ok()).toBeTruthy();
  const rowCount = page.locator("label").filter({ hasText: "Rows in selection:" }).locator("b");
  await expect(rowCount).toBeVisible();
  expect(Number((await rowCount.innerText()).trim())).toBeGreaterThan(30);
  await expect(page.getByRole("combobox", { name: "Search query", exact: true })).toHaveValue(/SUBSTRUCTURE/);
  const queryInput = page.getByRole("combobox", { name: "Search query", exact: true });
  const query = await queryInput.inputValue();
  await queryInput.fill(query.replace("C1CCCCC1", "C1CCCCCCC1"));
  const empty = page.waitForResponse(response => new URL(response.url()).pathname === "/search" && new URL(response.url()).searchParams.get("q")?.includes("C1CCCCCCC1") === true);
  await queryInput.press("Enter");
  expect((await (await empty).json()).data).toHaveLength(0);
  await expect(page.getByText("No data for given request", { exact: true })).toBeVisible();
});
