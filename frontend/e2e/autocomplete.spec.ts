import { expect, test } from "@playwright/test";

const metadata = [
  { column: "species", name: "Species name", type: "search specie" },
  { column: "family", name: "Family", type: "specie clas[7]" },
  { column: "name", name: "Chemical name", type: "search chemical" },
  { column: "smiles", name: "Structure", type: "chemical SMILES" },
  { column: "ref", name: "Publication", type: "search set ref[]" },
];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const page of ["search", "table"])
      localStorage.setItem(`fuco-tour:v1:${page}`, "done");
  });
  await page.route("**/metadata", (route) =>
    route.fulfill({ json: { metadata } }),
  );
  await page.route("**/search?*", (route) =>
    route.fulfill({ json: { metadata, data: [] } }),
  );
});
test("one input, fuzzy ranked values, column labels, grouped filters and exact conditions", async ({
  page,
}) => {
  const requests: URL[] = [];
  await page.route("**/autocomplete?*", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        suggestions: [
          { column: "name", show_name: "Chemical name", value: "Psoralen" },
          {
            column: "species",
            show_name: "Species name",
            value: "Psoralea corylifolia",
          },
        ],
      },
    });
  });
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await expect(input).toHaveCount(1);
  await input.fill("psorlen");
  await expect(page.getByRole("option").first()).toContainText("Psoralen");
  await expect(page.getByRole("option").first()).toContainText("Chemical name");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    page.getByRole("list", { name: "Search conditions" }),
  ).toContainText("Psoralen");
  await page.getByText(/Choose columns/).click();
  await expect(page.getByRole("checkbox", { name: "Species name", exact: true })).toBeHidden();
  await expect(page.getByText("Family", { exact: true })).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Chemicals" }).click();
  await page
    .getByRole("button", { name: "Clear columns", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Chemical name", exact: true })
    .check();
  await input.fill("psor");
  await expect(page.getByRole("option")).toHaveCount(1);
  expect(requests.at(-1)?.searchParams.get("columns")).toBe("name");
  await input.fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    /query=name\+%3D\+%27Psoralen%27|query=name%20%3D%20%27Psoralen%27/,
  );
});
test("stale responses and Escape never replace current suggestions", async ({
  page,
}) => {
  await page.route("**/autocomplete?*", async (route) => {
    const value = new URL(route.request().url()).searchParams.get("value")!;
    if (value === "old")
      await new Promise((resolve) => setTimeout(resolve, 650));
    await route
      .fulfill({
        json: {
          suggestions: [{ column: "name", show_name: "Chemical name", value }],
        },
      })
      .catch(() => {});
  });
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await input.fill("old");
  await page.waitForRequest((request) => request.url().includes("value=old"));
  await input.fill("new");
  await expect(page.getByRole("option")).toHaveText("newChemical name");
  await page.waitForTimeout(700);
  await expect(page.getByRole("option")).toHaveText("newChemical name");
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
test("parsed bibliography suggestions select the reference identifier", async ({
  page,
}) => {
  await page.route("**/autocomplete?*", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          {
            column: "ref",
            show_name: "Publication",
            value: "Smith2020",
            text: "Smith — Furanocoumarins of citrus (2020)",
          },
        ],
      },
    }),
  );
  await page.goto("/search");
  await page.getByRole("combobox").fill("citrus");
  await page.getByRole("option").click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("query")).toBe(
    "ref CONTAINS 'Smith2020'",
  );
});
test("results value completion requests only the selected column and retains fuzzy matches", async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route("**/autocomplete/*", (route) => {
    requested.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { values: ["Psoralen"] } });
  });
  await page.goto("/table");
  const input = page.getByRole("combobox", {
    name: "Search query",
    exact: true,
  });
  await input.fill("name = 'psorlen");
  await expect(
    page.getByRole("option", { name: "Psoralen", exact: true }),
  ).toBeVisible();
  expect(requested).toEqual(["/autocomplete/name"]);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("name = 'Psoralen' ");
});
test("SMILES templates, options, and local sketch export use the structure endpoint contract", async ({
  page,
}) => {
  const requests: URL[] = [];
  await page.route("**/autocomplete?*", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { suggestions: [] } });
  });
  await page.goto("/search");
  await page
    .getByRole("button", { name: "SMILES substructure", exact: true })
    .click();
  const input = page.getByRole("combobox");
  await expect(page.getByRole("button", { name: "Psoralen", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Choose columns/)).toHaveCount(0);
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Draw substructure" })).toBeVisible();
  await page.getByRole("button", { name: "Psoralen", exact: true }).click();
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(input).not.toHaveValue("");
  await expect.poll(() => requests.at(-1)?.searchParams.get("mode")).toBe("structure");
  expect(requests.at(-1)?.searchParams.get("scope")).toBe("search");
  await page.getByRole("checkbox", { name: "Match bond multiplicity" }).check();
  await page.getByRole("checkbox", { name: "Allow carbon to match heteroatoms" }).check();
  await page.getByRole("checkbox", { name: "Match stereochemistry" }).check();
  await input.focus();
  await expect.poll(() => requests.at(-1)?.searchParams.get("hetero_atoms")).toBe("true");
  expect(requests.at(-1)?.searchParams.get("bond_order")).toBe("true");
  await page.getByRole("button", { name: "Draw structure", exact: true }).click();
  await page.getByRole("button", { name: "Angelicin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use drawn structure" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await page.screenshot({ path: test.info().outputPath("ui-sketch-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: test.info().outputPath("ui-sketch-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Draw structure", exact: true })).toBeFocused();
  await input.fill("");
  await page
    .getByRole("button", { name: "Draw structure", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use drawn structure" }),
  ).toBeEnabled();
  await page.getByTestId("bonds").click();
  await page.getByTestId("canvas").click({ position: { x: 180, y: 180 } });
  await page.getByRole("button", { name: "Use drawn structure" }).click();
  await expect(input).toHaveValue("CC");
});

test("typed substructure submits the pattern and options without selecting a suggestion", async ({ page }) => {
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/search");
  await page.getByRole("button", { name: "SMILES substructure", exact: true }).click();
  await page.getByRole("combobox").fill("C1CCCCC1");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("query")).toBe("(smiles SUBSTRUCTURE 'C1CCCCC1')");
});

test("all-columns search supports catalogs larger than the explicit-filter limit", async ({
  page,
}) => {
  const largeCatalog = Array.from({ length: 80 }, (_, index) => ({
    column: `column${index}`,
    name: `Column ${index}`,
    type: "search chemical",
  }));
  await page.route("**/metadata", (route) =>
    route.fulfill({ json: { metadata: largeCatalog } }),
  );
  const requests: URL[] = [];
  await page.route("**/autocomplete?*", (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        suggestions: [
          { column: "column79", show_name: "Column 79", value: "Psoralen" },
        ],
      },
    });
  });
  await page.goto("/search");
  await page.getByRole("combobox").fill("psorlen");
  await expect(page.getByRole("option")).toHaveText("PsoralenColumn 79");
  expect(requests.at(-1)?.searchParams.has("columns")).toBe(false);
});

test("results use compact parameter autocomplete without separate structure controls", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/autocomplete/*", route => { requests.push(new URL(route.request().url())); return route.fulfill({ json: { values: [] } }); });
  await page.goto("/table");
  const input = page.getByRole("combobox", { name: "Search query", exact: true });
  await input.fill("fam");
  await expect(page.getByRole("option").filter({ hasText: "family" })).toBeVisible();
  await input.fill("smiles SUBSTRUCTURE 'C1CCCCC1");
  await expect.poll(() => requests.at(-1)?.searchParams.get("bond_order")).toBe("false");
  await expect(page.getByRole("checkbox", { name: "Match bond multiplicity" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Draw structure", exact: true })).toHaveCount(0);
  await input.fill("species = 'x' AND smiles SUB");
  await page.getByRole("option").filter({ hasText: "Choose bond multiplicity" }).click();
  await page.getByRole("option").filter({ hasText: "Allow carbon" }).click();
  await expect(input).toHaveValue("species = 'x' AND smiles SUBSTRUCTURE[hetero] '' ");
  await input.fill("smiles SUBSTRUCTURE[he 'C[N+]' AND species = 'x'");
  const caret = "smiles SUBSTRUCTURE[he".length;
  await input.press("Home");
  for (let i = 0; i < caret; i++) await input.press("ArrowRight");
  await expect(page.getByRole("option").filter({ hasText: "Allow carbon" })).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("smiles SUBSTRUCTURE[hetero] 'C[N+]' AND species = 'x'");
  await input.fill("smiles SUBSTRUCTURE[bonds,hetero] 'C1CCCCC1");
  await expect.poll(() => requests.at(-1)?.searchParams.get("bond_order")).toBe("true");
  expect(requests.at(-1)?.searchParams.get("hetero_atoms")).toBe("true");
});

test("legacy structure URLs display compact equivalents without extra controls", async ({ page }) => {
  const query = "smiles SUBSTRUCTURE[bond_multiplicity=false,hetero_atoms=true,stereochemistry=false] 'C1CCCCC1'";
  await page.goto(`/table?query=${encodeURIComponent(query)}`);
  await expect(page.getByRole("combobox", { name: "Search query", exact: true })).toHaveValue("smiles SUBSTRUCTURE[hetero] 'C1CCCCC1'");
  await expect(page.getByRole("button", { name: "Draw structure", exact: true })).toHaveCount(0);
});
