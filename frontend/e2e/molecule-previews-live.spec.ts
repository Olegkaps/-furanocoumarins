import { expect, test } from "@playwright/test";

test("workbook molecule previews and compact legacy results query", async ({ page }) => {
  test.skip(process.env.AUTOCOMPLETE_WORKBOOK_LIVE !== "1", "requires the local workbook dataset");
  await page.addInitScript(() => {
    for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.goto("/search");
  await page.getByRole("button", { name: "SMILES substructure", exact: true }).click();
  await page.getByRole("combobox").fill("C1CCCCC1");
  await expect(page.getByRole("option").first().getByRole("img")).toBeVisible();
  expect(await page.getByRole("option").first().locator("svg path, svg line").count()).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("molecule-home.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath("molecule-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/table?query=" + encodeURIComponent("(smiles SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false] 'C1CCCCC1')"));
  const input = page.getByRole("combobox", { name: "Search query", exact: true });
  await expect(input).toHaveValue("(smiles SUBSTRUCTURE[hetero] 'C1CCCCC1')");
  await expect(page.getByRole("button", { name: "Draw structure" })).toHaveCount(0);
  await input.fill("smiles SUBSTRUCTURE[hetero] 'C1CCCCC1");
  await expect(page.getByRole("option").first().getByRole("img")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("molecule-results.png") });
});
