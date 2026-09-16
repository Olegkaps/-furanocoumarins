import { expect, test, type Page } from "@playwright/test";

async function openDrawing(page: Page, smiles: string) {
  await page.addInitScript(() => localStorage.setItem("fuco-tour:v1:search", "done"));
  await page.route("**/metadata", route => route.fulfill({ json: { metadata: [
    { column: "smiles", name: "Structure", type: "chemical SMILES" },
  ] } }));
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/search");
  await page.getByRole("button", { name: "SMILES substructure", exact: true }).click();
  await page.getByRole("combobox").fill(smiles);
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use drawn structure" })).toBeEnabled();
}

const controls = (page: Page) => page.getByRole("group", { name: "Keep a radical from growing" });

test("fixes only the selected methyl atom, supports undo and removal, and keeps brackets on reopening", async ({ page }) => {
  await openDrawing(page, "OCOC");
  const panel = controls(page);
  await expect(panel.getByRole("button", { name: "Fix selected hydrogens", exact: true })).toBeDisabled();
  await page.getByTestId("left-toolbar-buttons").getByTestId("select-rectangle").click();
  const methyl = page.locator("[data-testid='atom'][data-atom-id='3']");
  await methyl.click();
  await panel.getByRole("button", { name: "Fix selected hydrogens", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("1 selected · 1 fixed");
  await expect(methyl).toHaveAttribute("data-atomImplicitHCount", "3");
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await expect(panel.getByRole("status")).toContainText("0 fixed");
  await page.getByRole("button", { name: /^Redo \(/ }).click();
  await expect(panel.getByRole("status")).toContainText("1 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  const input = page.getByRole("combobox");
  await expect(input).toHaveValue(/\[CH3\]/);
  expect((await input.inputValue()).match(/\[/g)).toHaveLength(1);
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("1 fixed");
  await page.getByTestId("left-toolbar-buttons").getByTestId("select-rectangle").click();
  await page.locator("[data-testid='atom'][data-atomImplicitHCount='3']").click();
  await panel.getByRole("button", { name: "Remove selected hydrogen fixes" }).click();
  await expect(panel.getByRole("status")).toContainText("0 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(input).not.toHaveValue(/\[/);
});

test("preserves typed brackets and resets fixed atoms when replacing with a template", async ({ page }) => {
  await openDrawing(page, "c1ccc(O[CH3])cc1");
  await expect(controls(page).getByRole("status")).toContainText("1 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(page.getByRole("combobox")).toHaveValue(/\[CH3\]/);
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await page.getByRole("button", { name: "Psoralen", exact: true }).click();
  await expect(controls(page).getByRole("status")).toContainText("0 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(page.getByRole("combobox")).not.toHaveValue(/CH3/);
});

test("fixes hydroxyl and methylene hydrogens and rejects an atom without hydrogens", async ({ page }) => {
  await openDrawing(page, "OCOC");
  const panel = controls(page);
  await page.getByTestId("left-toolbar-buttons").getByTestId("select-rectangle").click();
  await page.locator("[data-testid='atom'][data-atom-id='0']").click();
  await panel.getByRole("button", { name: "Fix selected hydrogens", exact: true }).click();
  await page.locator("[data-testid='atom'][data-atom-id='1']").click();
  await panel.getByRole("button", { name: "Fix selected hydrogens", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("2 fixed");
  await page.locator("[data-testid='atom'][data-atom-id='2']").click();
  await panel.getByRole("button", { name: "Fix selected hydrogens", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/Select atoms with hydrogens/);
  await expect(panel.getByRole("status")).toContainText("2 fixed");
  await page.screenshot({ path: test.info().outputPath("hydrogen-controls-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath("hydrogen-controls-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(page.getByRole("combobox")).toHaveValue(/\[CH2\]/);
  await expect(page.getByRole("combobox")).toHaveValue(/\[OH\]/);
});

test("removes aromatic fixes and refuses to silently reduce a fixed methyl after extending it", async ({ page }) => {
  await openDrawing(page, "[cH]1ccccc1OC");
  const panel = controls(page);
  await page.getByTestId("left-toolbar-buttons").getByTestId("select-rectangle").click();
  await page.locator("[data-testid='atom'][data-atomImplicitHCount='1']").first().click();
  await panel.getByRole("button", { name: "Remove selected hydrogen fixes" }).click();
  await expect(panel.getByRole("status")).toContainText("0 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  const input = page.getByRole("combobox");
  await expect(page.getByRole("dialog", { name: "Draw substructure" })).toHaveCount(0);
  await input.fill("O[CH3]");
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use drawn structure" })).toBeEnabled();
  await expect(panel.getByRole("status")).toContainText("1 fixed");
  await page.getByTestId("bonds").click();
  await page.locator("[data-testid='atom'][data-atomImplicitHCount='3']").click();
  await expect(page.getByTestId("atom")).toHaveCount(3);
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(page.getByRole("dialog", { name: "Draw substructure" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /^Undo \(/ }).click();
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(input).toHaveValue(/\[CH3\]/);
});

for (const [source, expected] of [
  ["N[C@@H](C)C(=O)O", "N[C@H](C(O)=O)C"],
  ["N[C@H](C)C(=O)O", "N[C@@H](C(O)=O)C"],
]) test(`keeps stereochemistry when exporting ${source}`, async ({ page }) => {
  await openDrawing(page, source);
  await expect(controls(page).getByRole("status")).toContainText("1 fixed");
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  // Atom order changes on export; these opposite @ forms have the same
  // isomeric identity, independently checked with native RDKit.
  await expect(page.getByRole("combobox")).toHaveValue(expected);
});
