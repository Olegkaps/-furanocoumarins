import { test, expect } from "@playwright/test";

const metadata = [
  { column: "taxon", name: "Species", type: "search clas[0] specie" },
  { column: "parent", name: "Genus", type: "search clas[1] specie" },
  { column: "hidden", name: "Hidden species", type: "clas[0][other] specie" },
];
const combined = "__classification_name";
const genus = { column: "parent", type: metadata[1].type, value: "Angelica" };
const species = { column: "taxon", type: metadata[0].type, value: "archangelica" };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const p of ["search", "table"]) localStorage.setItem(`fuco-tour:v1:${p}`, "done");
  });
  await page.route("**/metadata", route => route.fulfill({ json: { metadata } }));
  await page.route("**/search?*", route => route.fulfill({ json: { metadata, data: [] } }));
});

for (const full of [true, false]) {
  test(`classification selects ${full ? "a full name" : "a genus"} with real column conditions`, async ({ page }) => {
    await page.route("**/autocomplete?*", route => {
      expect(new URL(route.request().url()).searchParams.get("columns")).toBe(full ? combined : "parent");
      return route.fulfill({ json: { suggestions: [{
        column: full ? combined : "parent", show_name: full ? "genus + species" : "Genus",
        value: full ? "Angelica archangelica" : "Angelica",
        conditions: full ? [species, genus] : undefined,
      }] } });
    });
    await page.goto("/search");
    await page.getByText("Choose columns (3)", { exact: true }).click();
    await page.getByRole("button", { name: "Clear columns", exact: true }).click();
    await page.locator("summary").filter({ hasText: /^Species / }).click();
    await page.getByRole("checkbox", { name: full ? "genus + species" : "Genus", exact: true }).check();
    const input = page.getByRole("combobox");
    await input.fill(full ? "angelca archang" : "angelca");
    await page.getByRole("option").click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const query = new URL(page.url()).searchParams.get("query");
    expect(query).toBe(full ? "(taxon = 'archangelica' AND parent = 'Angelica')" : "parent = 'Angelica'");
    await expect(page.getByRole("combobox", { name: "Search query", exact: true })).not.toHaveValue(/__classification_name/);
  });
}

test("typed full name works without choosing a suggestion", async ({ page }) => {
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/search");
  await page.getByText("Choose columns (3)", { exact: true }).click();
  await page.getByRole("button", { name: "Clear columns", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Species / }).click();
  await page.getByRole("checkbox", { name: "genus + species", exact: true }).check();
  await page.getByRole("combobox").fill("Angelica archangelica");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const query = new URL(page.url()).searchParams.get("query");
  expect(query).toContain("(parent = 'Angelica' AND taxon = 'archangelica')");
  expect(query).not.toContain(combined);
});

test("hidden or missing ranks do not create combined option", async ({ page }) => {
  await page.route("**/metadata", route => route.fulfill({ json: { metadata: [metadata[0], { ...metadata[1], type: "clas[1] specie" }] } }));
  await page.goto("/search");
  await page.getByText("Choose columns (1)", { exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Species / }).click();
  await expect(page.getByRole("checkbox", { name: "genus + species", exact: true })).toHaveCount(0);
});

test("identical labels in different classification systems retain distinct selections", async ({ page }) => {
  const tagged = metadata.slice(0, 2).map(c => ({
    ...c, column: c.column + "_accepted", type: c.type.replace(/clas\[\d+\]/, "$&[accepted]"),
  }));
  await page.route("**/metadata", route => route.fulfill({ json: { metadata: [...metadata, ...tagged] } }));
  const choices = [
    { column: combined, show_name: "genus + species", value: "Angelica archangelica", conditions: [species, genus] },
    { column: combined, show_name: "genus + species (accepted)", value: "Angelica archangelica", conditions: [
      { ...species, column: "taxon_accepted" }, { ...genus, column: "parent_accepted" },
    ] },
  ];
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: choices } }));
  await page.goto("/search");
  const input = page.getByRole("combobox");
  await input.fill("angelica");
  await page.getByRole("option").filter({ hasText: /^Angelica archangelicagenus \+ species$/ }).click();
  await input.fill("angelica");
  await page.getByRole("option").filter({ hasText: "(accepted)" }).click();
  await expect(page.getByRole("list", { name: "Search conditions" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("query")).toBe(
    "(taxon = 'archangelica' AND parent = 'Angelica') OR (taxon_accepted = 'archangelica' AND parent_accepted = 'Angelica')",
  );
});

for (const operator of ["OR", "AND"]) {
test(`selected values and remaining input combine with ${operator}`, async ({ page }) => {
  const extra = { column: "radicals", name: "Radicals", type: "search set chemical" };
  await page.route("**/metadata", route => route.fulfill({ json: { metadata: [...metadata, extra] } }));
  await page.route("**/autocomplete?*", route => route.fulfill({ json: { suggestions: [
    { column: combined, show_name: "genus + species", value: "Angelica archangelica", conditions: [species, genus] },
    { column: combined, show_name: "genus + species", value: "Heracleum sphondylium", conditions: [
      { ...species, value: "sphondylium" }, { ...genus, value: "Heracleum" },
    ] },
    { column: "radicals", show_name: "Radicals", value: "O'Brien" },
  ] } }));
  await page.goto("/search");
  const input = page.getByRole("combobox");
  for (const value of ["Angelica archangelica", "Heracleum sphondylium", "O'Brien"]) {
    await input.fill(value);
    await page.getByRole("option").filter({ hasText: value }).click();
  }
  const selected = page.getByRole("list", { name: "Search conditions" });
  await expect(page.getByRole("radio", { name: "Any (OR)", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "All (AND)", exact: true }).check();
  await expect(selected.locator("strong")).toHaveText(["AND ", "AND "]);
  if (operator === "OR") await page.getByRole("radio", { name: "Any (OR)", exact: true }).check();
  await expect(selected.locator("strong")).toHaveText([`${operator} `, `${operator} `]);
  await page.locator("summary").filter({ hasText: /^Choose columns/ }).click();
  await page.getByRole("button", { name: "Clear columns", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Species / }).click();
  await page.getByRole("checkbox", { name: "Genus", exact: true }).check();
  await page.getByRole("checkbox", { name: "Species", exact: true }).check();
  await input.fill("Ruta");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("query")).toBe(
    `(taxon = 'archangelica' AND parent = 'Angelica') ${operator} (taxon = 'sphondylium' AND parent = 'Heracleum') ${operator} radicals CONTAINS 'O''Brien' ${operator} (taxon = 'Ruta' OR parent = 'Ruta')`,
  );
});

}
