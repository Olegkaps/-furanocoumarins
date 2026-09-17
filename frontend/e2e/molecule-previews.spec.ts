import { expect, test } from "@playwright/test";

const molecule = "O=c1ccc2cc3occc3cc2o1";
const metadata = [
  { column: "smiles", show_name: "Chemical structure", type: "chemical SMILES" },
  { column: "name", show_name: "Chemical name", type: "chemical search" },
];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${name}`, "done");
  });
  await page.route("**/metadata", route => route.fulfill({ json: { metadata } }));
  await page.route("**/search?*", route => route.fulfill({ json: { metadata, data: [] } }));
});

test("home suggestions draw local molecules, preserve failed values, and select by keyboard", async ({ page }) => {
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: [
    { column: "smiles", show_name: "Chemical structure", value: molecule },
    { column: "smiles", show_name: "Chemical structure", value: "invalid<svg onload=alert(1)>" },
    { column: "smiles", show_name: "Chemical structure", value: "C".repeat(1025) },
    { column: "name", show_name: "Chemical name", value: "Psoralen" },
  ] } }));
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await input.fill("psor");
  const first = page.getByRole("option").first();
  await expect(first.getByRole("img", { name: `Molecule structure: ${molecule}`, exact: true })).toBeVisible();
  expect(await first.locator("svg path, svg line").count()).toBeGreaterThan(0);
  await expect(first).toContainText("Chemical structure");
  await expect(page.getByRole("option").nth(1)).toContainText("Preview unavailable");
  await expect(page.getByRole("option").nth(2)).toContainText("Preview unavailable");
  await expect(page.getByRole("option").last().locator(".molecule-preview")).toHaveCount(0);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByRole("list", { name: "Search conditions" })).toContainText(molecule);
});

test("results autocomplete draws only the selected SMILES column and retains click selection", async ({ page }) => {
  await page.route("**/autocomplete/smiles?*", route => route.fulfill({ json: { values: [molecule] } }));
  await page.goto("/table?query=" + encodeURIComponent("smiles SUBSTRUCTURE 'C1CCCCC1'"));
  const input = page.getByRole("combobox", { name: "Search query", exact: true });
  await input.fill("smiles SUBSTRUCTURE 'C1");
  const option = page.getByRole("option").first();
  await expect(option.getByRole("img")).toBeVisible();
  expect(await option.locator("svg path, svg line").count()).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Draw structure" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Match bond multiplicity" })).toHaveCount(0);
  await option.click();
  await expect(input).toHaveValue(`smiles SUBSTRUCTURE '${molecule}' `);
});
