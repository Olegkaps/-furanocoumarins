import { expect, test, type Page } from "@playwright/test";

type AboutSubpage = { id: string; name: string; icon: string };

async function openAboutSubpage(page: Page, options: { failSave?: boolean; holdSave?: boolean; startAt?: string } = {}) {
  let pages: AboutSubpage[] = [{ id: "methods", name: "Methods", icon: "species" }];
  const saves: AboutSubpage[][] = [];
  const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
  await page.addInitScript((value) => {
    localStorage.setItem("auth-token", value);
    localStorage.setItem("auth-refresh-token", "mock-refresh-token");
  }, token);
  await page.route("**/about/pages", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ pages }) }));
  await page.route("**/pages/**", (route) => route.fulfill({ status: 404 }));
  let releaseSave: (() => Promise<void>) | undefined;
  await page.route("**/admin/about/pages", (route) => {
    saves.push(route.request().postDataJSON().pages as AboutSubpage[]);
    if (options.failSave) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    if (options.holdSave) return new Promise<void>((resolve) => {
      releaseSave = async () => {
        pages = saves.at(-1)!;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ pages }) });
        resolve();
      };
    });
    pages = saves.at(-1)!;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ pages }) });
  });
  await page.goto(options.startAt ?? "/about/methods");
  await expect(page.locator(".about-subpages").getByRole("link", { name: "About", exact: true })).toBeVisible();
  return { saves, releaseSave: async () => {
    if (!releaseSave) throw new Error("The catalog save did not start");
    await releaseSave();
  } };
}

async function openIconPicker(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Choose icon for Methods" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test("icon picker is an anchored overlay and keeps row controls in place", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await openAboutSubpage(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const row = page.locator(".about-subpage-manager__row");
  const name = page.getByRole("textbox", { name: "Subpage 1 name" });
  const editor = page.getByRole("button", { name: "Open Markdown editor for Methods" });
  const rowBefore = await row.boundingBox();
  const nameBefore = await name.boundingBox();
  const editorBefore = await editor.boundingBox();
  await page.getByRole("button", { name: "Choose icon for Methods" }).click();
  await expect(page.getByRole("group", { name: "Subpage 1 icon" })).toBeVisible();
  const palette = await page.getByRole("group", { name: "Subpage 1 icon" }).boundingBox();
  const viewport = page.viewportSize();
  expect(palette).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(palette!.x).toBeGreaterThanOrEqual(0);
  expect(palette!.y).toBeGreaterThanOrEqual(0);
  expect(palette!.x + palette!.width).toBeLessThanOrEqual(viewport!.width);
  expect(palette!.y + palette!.height).toBeLessThanOrEqual(viewport!.height);
  const rowAfter = await row.boundingBox();
  const nameAfter = await name.boundingBox();
  const editorAfter = await editor.boundingBox();
  expect(rowBefore).not.toBeNull();
  expect(nameBefore).not.toBeNull();
  expect(editorBefore).not.toBeNull();
  expect(rowAfter).not.toBeNull();
  expect(nameAfter).not.toBeNull();
  expect(editorAfter).not.toBeNull();
  expect({ x: nameAfter!.x - rowAfter!.x, y: nameAfter!.y - rowAfter!.y, width: nameAfter!.width, height: nameAfter!.height }).toEqual({ x: nameBefore!.x - rowBefore!.x, y: nameBefore!.y - rowBefore!.y, width: nameBefore!.width, height: nameBefore!.height });
  expect({ x: editorAfter!.x - rowAfter!.x, y: editorAfter!.y - rowAfter!.y, width: editorAfter!.width, height: editorAfter!.height }).toEqual({ x: editorBefore!.x - rowBefore!.x, y: editorBefore!.y - rowBefore!.y, width: editorBefore!.width, height: editorBefore!.height });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Subpage 1 icon" })).toHaveCount(0);
});

test("About subpages return to About and save an icon selection before opening Markdown", async ({ page }) => {
  const { saves, releaseSave } = await openAboutSubpage(page, { holdSave: true, startAt: "/about" });
  await page.locator(".about-subpages").getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await openIconPicker(page);
  const chemicals = page.getByRole("button", { name: "Use Chemicals icon" });
  await chemicals.click();
  await expect(chemicals).toHaveCount(0);
  const saveRequest = page.waitForRequest("**/admin/about/pages");
  await page.getByRole("button", { name: "Open Markdown editor for Methods" }).click();
  await saveRequest;
  expect(saves).toEqual([[{ id: "methods", name: "Methods", icon: "chemicals" }]]);
  await expect(page).toHaveURL(/\/about$/);
  await releaseSave();
  await expect(page).toHaveURL(/\/about\/methods$/);
});

test("failed subpage catalog saves do not navigate and deleting the current page returns to About", async ({ page }) => {
  await openAboutSubpage(page, { failSave: true });
  await openIconPicker(page);
  await page.getByRole("button", { name: "Open Markdown editor for Methods" }).click();
  await expect(page).toHaveURL(/\/about\/methods$/);
  await expect(page.getByText("Request failed with status code 500")).toBeVisible();

  const { saves } = await openAboutSubpage(page);
  await openIconPicker(page);
  await page.getByRole("button", { name: "Remove Methods" }).click();
  await page.getByRole("button", { name: "Save subpages", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  expect(saves).toEqual([[]]);
});
