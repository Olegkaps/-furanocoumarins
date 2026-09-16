import { expect, test } from "@playwright/test";

test("fixed methyl stays local while other substitutions remain searchable", async ({ page }) => {
  test.skip(process.env.AUTOCOMPLETE_WORKBOOK_LIVE !== "1", "requires local workbook-backed native search");
  await page.addInitScript(() => {
    for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.goto("/search");
  await page.getByRole("button", { name: "SMILES substructure", exact: true }).click();
  await expect(page.getByText(/Use.*O\[CH3\].*methyl/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Allow carbon to match heteroatoms" }).check();
  await page.getByRole("combobox").fill("c1ccc(O[CH3])cc1");
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(page.getByRole("option").first().getByRole("img")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("fixed-methyl.png") });
  const result = page.waitForResponse(response => new URL(response.url()).pathname === "/search" && new URL(response.url()).searchParams.has("q"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect((await result).ok()).toBeTruthy();
  const input = page.getByRole("combobox", { name: "Search query", exact: true });
  await expect(input).toHaveValue("(smiles SUBSTRUCTURE[hetero] 'c1ccc(O[CH3])cc1')");
  const rowCount = page.locator("label").filter({ hasText: "Rows in selection:" }).locator("b");
  await expect(rowCount).toBeVisible();
  const fixedCount = Number((await rowCount.innerText()).trim());
  expect(fixedCount).toBeGreaterThan(0);
  await input.fill("smiles SUBSTRUCTURE[hetero] 'c1ccc(OC)cc1'");
  const openResult = page.waitForResponse(response => new URL(response.url()).pathname === "/search" && new URL(response.url()).searchParams.get("q") === "smiles SUBSTRUCTURE[hetero] 'c1ccc(OC)cc1'");
  await input.press("Enter");
  expect((await openResult).ok()).toBeTruthy();
  await expect.poll(async () => Number((await rowCount.innerText()).trim())).toBeGreaterThan(fixedCount);
});
