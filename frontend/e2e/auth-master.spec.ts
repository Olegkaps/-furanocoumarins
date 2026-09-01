import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

async function waitForAccessExpiry(page: Page) {
	await expect.poll(() => page.evaluate(() => {
		const token = localStorage.getItem("auth-token");
		if (!token) return false;
		const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
		const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as { exp?: number };
		return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
	}), { timeout: 10_000 }).toBe(true);
}

async function mailIDs(request: APIRequestContext) {
	const list = await (await request.get("http://127.0.0.1:18025/api/v1/messages")).json();
	return new Set<string>((list.messages ?? []).map((m: { ID: string }) => m.ID));
}
async function latestMail(request: APIRequestContext, subject: string, recipient: string, before: Set<string>) {
  await expect.poll(async () => {
    const list = await (await request.get("http://127.0.0.1:18025/api/v1/messages")).json();
	return list.messages?.some((m: { ID: string; Subject: string; To: { Address: string }[] }) => !before.has(m.ID) && m.Subject === subject && m.To?.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()));
  }).toBe(true);
  const list = await (await request.get("http://127.0.0.1:18025/api/v1/messages")).json();
	const item = list.messages.find((m: { ID: string; Subject: string; To: { Address: string }[] }) => !before.has(m.ID) && m.Subject === subject && m.To?.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()));
  return await (await request.get(`http://127.0.0.1:18025/api/v1/message/${item.ID}`)).json();
}

async function signInByMagic(page: Page, request: APIRequestContext, identity: string, recipient: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in by mail" }).click();
  await page.getByLabel("Username or email").fill(identity);
	const beforeMail = await mailIDs(request);
  await page.getByRole("button", { name: "Send login link" }).click();
	await expect(page.getByText("If the account exists, a sign-in link was requested. If it does not arrive, wait briefly and request another link.")).toBeVisible();
	const loginMail = await latestMail(request, "Your login link", recipient, beforeMail);
  const link = String(loginMail.Text).match(/https?:\/\/[^\s]+/)?.[0];
	expect(link).toBeTruthy();
	await page.goto(link!);
	await expect(page).toHaveURL(/admin/);
}

async function findExactRole(request: APIRequestContext, headers: Record<string, string>, name: string) {
	let cursor = "";
	const seen = new Set<string>();
	for (let page = 0; page < 1000; page += 1) {
		const response = await request.get(`http://localhost:8081/auth/admin/roles?q=${encodeURIComponent(name)}&page_size=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
		expect(response.status()).toBe(200);
		const body = await response.json();
		const match = (body.roles ?? []).find((role: { name: string }) => role.name === name);
		if (match) return match;
		const next = String(body.next_cursor ?? "");
		if (!next || next === cursor || seen.has(next)) break;
		seen.add(next);
		cursor = next;
	}
	throw new Error(`exact role ${name} was not found`);
}

function deterministicImportWorkbook(): Buffer {
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		["sheet", "column", "type", "description", "show_name"],
		["__LIST__", "main", "main", "", ""],
		["__LIST__", "structures", "structures", "", ""],
		["__LIST__", "classification", "classification", "", ""],
		["main", "id", "primary", "", "ID"],
		["main", "chemical_id", "external[structures]", "", "Chemical ID"],
		["structures", "chemical_id", "primary", "", "Chemical ID"],
		["structures", "chemical", "search", "", "Chemical"],
		["structures", "smiles", "smiles table_chemical", "", "SMILES"],
		["main", "species_id", "external[classification]", "", "Species ID"],
		["classification", "species_id", "primary", "", "Species ID"],
		["classification", "species", "search", "", "Species"],
		["classification", "family", "clas[01][gbif] table_specie", "", "Family"],
		["main", "references", "ref[]", "", "References"],
		["main", "source_link", "link[https://example.test/articles/%s] table_", "", "Source"],
		["main", "aliases", "set[Bergapten Psoralen] chemical", "", "Aliases"],
	]), "meta");
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		["id", "chemical_id", "species_id", "references", "source_link", "aliases"],
		["1", "chem-1", "species-1", "ref-real", "ref-real", "Bergapten Psoralen"],
	]), "main");
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		["chemical_id", "chemical", "smiles"],
		["chem-1", "Bergapten", "COC1=CC2=C(C=C1)C(=O)OC2"],
	]), "structures");
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		["species_id", "species", "family"],
		["species-1", "Ruta graveolens", "Rutaceae"],
	]), "classification");
	return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function malformedImportWorkbook(): Buffer {
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		["sheet", "column", "type", "description", "show_name"],
		["__LIST__", "main", "main", "", ""],
		["__LIST__", "classification", "classification", "", ""],
		["main", "id", "primary", "", "ID"],
		["main", "broken", "external[", "", "Broken external"],
		["classification", "cid", "primary", "", "CID"],
	]), "meta");
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["id", "broken"], ["1", "x"]]), "main");
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["cid"], ["x"]]), "classification");
	return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadTableThroughUI(page: Page, name: string) {
	const requestPromise = page.waitForRequest((request) => request.url().endsWith("/create-table") && request.method() === "POST");
	const responsePromise = page.waitForResponse((response) => response.url().endsWith("/create-table") && response.request().method() === "POST");
	await page.getByRole("button", { name: "Create table" }).click();
	const workbook = deterministicImportWorkbook();
	const spreadsheetInput = page.getByLabel("Spreadsheet file");
	await spreadsheetInput.setInputFiles({ name: "deterministic.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
	await expect(spreadsheetInput).toHaveValue(/deterministic\.xlsx$/);
	expect(await spreadsheetInput.evaluate((input: HTMLInputElement) => input.files?.[0]?.size ?? 0)).toBe(workbook.length);
	await page.getByLabel("Table name").fill(name);
	await page.getByLabel("Metadata list").fill("meta");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	const [mutationRequest, mutationResponse] = await Promise.all([requestPromise, responsePromise]);
	expect(await mutationRequest.headerValue("content-type")).toContain("multipart/form-data");
	expect(mutationResponse.status()).toBe(200);
	const accepted = await mutationResponse.json();
	expect(accepted.import_id).toMatch(/^[0-9a-f-]{36}$/);
	const notice = page.getByTestId("table-notice");
	await expect.poll(async () => {
		const text = await notice.textContent();
		return text === `${name} is Ready` || text?.includes("import failed (Broken)") === true;
	}, { timeout: 120_000 }).toBe(true);
	await expect(notice).toHaveText(`${name} is Ready`);
	const tableCard = page.locator(`.admin-table-card[data-table-name="${name}"]`);
	await expect(tableCard).toBeVisible();
	await expect(tableCard.getByText("Ready", { exact: true })).toBeVisible();
	return tableCard;
}

async function uploadMalformedTableThroughUI(page: Page, name: string) {
	await page.getByRole("button", { name: "Create table" }).click();
	await page.getByLabel("Spreadsheet file").setInputFiles({
		name: "malformed.xlsx",
		mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		buffer: malformedImportWorkbook(),
	});
	await page.getByLabel("Table name").fill(name);
	await page.getByLabel("Metadata list").fill("meta");
	const accepted = page.waitForResponse((response) => response.url().endsWith("/create-table") && response.request().method() === "POST");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	expect((await accepted).status()).toBe(200);
	await expect(page.getByTestId("table-notice")).toContainText("import failed (Broken)", { timeout: 120_000 });
}

async function dismissAdminTour(page: Page) {
	const skipTour = page.getByRole("button", { name: "Skip tour" });
	try {
		await skipTour.waitFor({ state: "visible", timeout: 2_000 });
		await skipTour.click();
	} catch {
		// The tour is stored per browser profile and is absent on later visits.
	}
}

async function expectScientificRowSet(results: Locator, expected: string[]) {
	await expect.poll(async () => {
		return results.locator("tbody tr").evaluateAll((rows) => rows.map((row) => {
			const element = row as HTMLElement;
			return `${element.dataset.rowSpecies ?? ""}/${element.dataset.rowChemical ?? ""}`;
		}).sort());
	}).toEqual([...expected].sort());
}

async function openMockedAdmin(page: Page) {
	const payload = Buffer.from(JSON.stringify({ login: "mock-admin", exp: 4_102_444_800 })).toString("base64url");
	await page.addInitScript((token) => {
		localStorage.setItem("auth-token", token);
		localStorage.setItem("auth-refresh-token", "mock-refresh-token");
		localStorage.setItem("name", "mock-admin");
	}, `eyJhbGciOiJub25lIn0.${payload}.signature`);
	await page.route("**/get-tables-list", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
	await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"id":"11111111-1111-4111-8111-111111111111","login":"mock-admin","kind":"human","superuser":true}' }));
	await page.route("**/auth/sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
	await page.route("**/auth/admin/roles?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"roles":[]}' }));
	await page.route("**/auth/admin/users?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"users":[]}' }));
	await page.goto("/admin");
	await dismissAdminTour(page);
	await expect(page.getByRole("button", { name: "Create table" })).toBeVisible();
}

async function submitMockedImport(page: Page, name: string) {
	await page.getByRole("button", { name: "Create table" }).click();
	await page.getByLabel("Spreadsheet file").setInputFiles({ name: "mock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: deterministicImportWorkbook() });
	await page.getByLabel("Table name").fill(name);
	await page.getByLabel("Metadata list").fill("meta");
	await page.getByRole("button", { name: "Create", exact: true }).click();
}

for (const scenario of [
	{ name: "ready", response: { status: 200, body: '{"state":"ready"}' }, notice: "mock-ready is Ready" },
	{ name: "broken", response: { status: 200, body: '{"state":"broken"}' }, notice: "mock-broken import failed (Broken)" },
	{ name: "missing after restart", response: { status: 404, body: '{"error":"not found"}' }, notice: "mock-missing after restart import status is unavailable; the server may have restarted" },
	{ name: "status error", response: { status: 503, body: '{"error":"temporary"}' }, notice: "Could not read mock-status error import status. Reload the table list before retrying" },
	{ name: "malformed", response: { status: 200, body: '{"state":"surprising"}' }, notice: "mock-malformed import returned an invalid status" },
]) {
	test(`import polling exposes ${scenario.name} terminal recovery`, async ({ page }) => {
		await openMockedAdmin(page);
		await page.route("**/create-table", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"import_id":"11111111-1111-4111-8111-111111111111"}' }));
		await page.route("**/table-imports/*", (route) => route.fulfill({ status: scenario.response.status, contentType: "application/json", body: scenario.response.body }));
		await submitMockedImport(page, `mock-${scenario.name}`);
		await expect(page.getByTestId("table-notice")).toContainText(scenario.notice);
	});
}

test("busy import preserves the selected workbook and form values", async ({ page }) => {
	await openMockedAdmin(page);
	await page.route("**/create-table", (route) => route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"another import is already running; wait and retry"}' }));
	await submitMockedImport(page, "preserved-name");
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByLabel("Spreadsheet file")).toHaveValue(/mock\.xlsx$/);
	await expect(page.getByLabel("Table name")).toHaveValue("preserved-name");
	await expect(page.getByLabel("Metadata list")).toHaveValue("meta");
	await expect(page.getByTestId("table-notice")).toContainText("Your file and form values are preserved");
});

test("import polling reports a bounded timeout without blind resubmission", async ({ page }) => {
	await page.clock.install({ time: new Date("2026-08-28T12:00:00Z") });
	await openMockedAdmin(page);
	let statusCalls = 0;
	await page.route("**/create-table", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"import_id":"22222222-2222-4222-8222-222222222222"}' }));
	await page.route("**/table-imports/*", (route) => {
		statusCalls += 1;
		return route.fulfill({ status: 200, contentType: "application/json", body: '{"state":"importing"}' });
	});
	await submitMockedImport(page, "mock-timeout");
	await expect.poll(() => statusCalls).toBeGreaterThan(0);
	await page.clock.fastForward(121_000);
	await expect(page.getByTestId("table-notice")).toContainText("may still be running; reload the table list before retrying");
});

test("passwordless migrated superuser has immediate authority, repeat magic login, and optional reset", async ({ browser, page, request }) => {
	const adminRoleQueries: string[] = [];
	page.on("request", (outgoing) => {
		if (outgoing.url().includes("/auth/admin/roles")) adminRoleQueries.push(outgoing.url());
	});
	const beforeMagic = await request.post("http://localhost:8081/auth/login", { form: { uname_or_email: "migrated", password: "must-never-be-copied" } });
	expect(beforeMagic.status()).toBe(401);
	let magicConfirmations = 0;
	const countMagicConfirmation = (request: { url(): string }) => { if (request.url().endsWith("/auth/confirm-login-mail")) magicConfirmations += 1; };
	page.on("request", countMagicConfirmation);
	await signInByMagic(page, request, "MIGRATED.USER@example.test", "migrated.user@example.test");
	await expect.poll(() => magicConfirmations).toBe(1);
	page.off("request", countMagicConfirmation);
	await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();
	await expect(page.getByText("Users and invitations")).toBeVisible();
	await dismissAdminTour(page);
	await expect.poll(() => adminRoleQueries.some((raw) => new URL(raw).searchParams.get("q") === "admin" && new URL(raw).searchParams.get("page_size") === "25")).toBe(true);
	await expect.poll(() => adminRoleQueries.some((raw) => Boolean(new URL(raw).searchParams.get("cursor")))).toBe(true);
	const importedTable = await uploadTableThroughUI(page, "passwordless-authority");
	const activationResponse = page.waitForResponse((response) => response.url().includes("/make-table-active/") && response.request().method() === "POST");
	await importedTable.getByRole("button", { name: "Activate" }).click();
	expect((await activationResponse).status()).toBe(200);
	await expect(importedTable.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });

	// This request is deliberately served by the real browser-driven backend
	// and Cassandra stack. It proves that the visible Ready/Active card reflects
	// persisted joins, searchable values, and the reference column—not only a
	// successful registry mutation.
	const importedSearch = await page.request.get("http://localhost:8081/search", {
		params: { q: "chemical = 'Bergapten'" },
	});
	expect(importedSearch.status()).toBe(200);
	const importedPayload = await importedSearch.json();
	expect(importedPayload.data).toHaveLength(1);
	expect(importedPayload.data[0]).toMatchObject({
		chemical_id: "chem-1",
		chemical: "Bergapten",
		smiles: "COC1=CC2=C(C=C1)C(=O)OC2",
		species_id: "species-1",
		species: "Ruta graveolens",
		family: "Rutaceae",
		references: "ref-real",
		source_link: "ref-real",
		aliases: expect.arrayContaining(["Bergapten", "Psoralen"]),
	});
	expect(importedPayload.metadata).toEqual(expect.arrayContaining([
		expect.objectContaining({ column: "chemical", type: expect.stringContaining("chemical") }),
		expect.objectContaining({ column: "smiles", type: "smiles table_chemical chemical" }),
		expect.objectContaining({ column: "species", type: expect.stringContaining("specie") }),
		expect.objectContaining({ column: "references", type: "ref[]" }),
		expect.objectContaining({ column: "family", type: "clas[01][gbif] table_specie specie" }),
		expect.objectContaining({ column: "source_link", type: "link[https://example.test/articles/%s] table_" }),
		expect.objectContaining({ column: "aliases", type: "set[Bergapten Psoralen] chemical" }),
	]));

	// An invalid or Broken activation is a checked Cassandra LWT failure and
	// must not clear the existing pointer. Two concurrent valid activations are
	// serialized and finish with exactly one Ready dataset active.
	await uploadMalformedTableThroughUI(page, "malformed-external-metadata");
	await page.reload();
	await expect(page.getByTestId("account-security")).toBeVisible();
	await dismissAdminTour(page);
	const currentActivationHeaders = async () => {
		// A 5-second access token can expire during a real Cassandra import. Let
		// the browser interceptor complete its refresh/retry before taking the
		// credential snapshot used by the direct invalid-activation probes.
		const tableListReady = page.waitForResponse((response) =>
			response.url().endsWith("/get-tables-list") &&
			response.request().method() === "POST" &&
			response.status() === 200,
		);
		await page.reload();
		await tableListReady;
		await expect(page.locator('.admin-table-card[data-table-name="passwordless-authority"]')).toBeVisible();
		const auth = await page.evaluate(() => ({
			access: localStorage.getItem("auth-token")!,
			csrf: localStorage.getItem("auth-csrf-token")!,
		}));
		return { Authorization: `Bearer ${auth.access}`, "X-CSRF-Token": auth.csrf };
	};
	const readTables = async () => {
		const response = await page.request.post("http://localhost:8081/get-tables-list", { headers: await currentActivationHeaders(), data: {} });
		expect(response.status()).toBe(200);
		return await response.json() as Array<{ name: string; created_at: string; is_active: boolean; is_ok: boolean }>;
	};
	let activationTables = await readTables();
	const firstReady = activationTables.find((table) => table.name === "passwordless-authority")!;
	const broken = activationTables.find((table) => table.name === "activation-not-ready-fixture")!;
	expect(firstReady.is_active).toBe(true);
	expect(broken.is_ok).toBe(false);
	let activationHeaders = await currentActivationHeaders();
	const missingActivation = await page.request.post(`http://localhost:8081/make-table-active/${encodeURIComponent("2040-01-01T00:00:00.000Z")}`, { headers: activationHeaders, data: {} });
	expect(missingActivation.status()).toBe(400);
	const brokenActivation = await page.request.post(`http://localhost:8081/make-table-active/${encodeURIComponent(broken.created_at)}`, { headers: activationHeaders, data: {} });
	expect(brokenActivation.status()).toBe(400);
	activationTables = await readTables();
	expect(activationTables.filter((table) => table.is_active).map((table) => table.name)).toEqual(["passwordless-authority"]);

	await uploadTableThroughUI(page, "concurrent-activation-ready");
	activationTables = await readTables();
	const secondReady = activationTables.find((table) => table.name === "concurrent-activation-ready")!;
	activationHeaders = await currentActivationHeaders();
	const concurrentActivations = await Promise.all([
		page.request.post(`http://localhost:8081/make-table-active/${encodeURIComponent(firstReady.created_at)}`, { headers: activationHeaders, data: {} }),
		page.request.post(`http://localhost:8081/make-table-active/${encodeURIComponent(secondReady.created_at)}`, { headers: activationHeaders, data: {} }),
	]);
	expect(concurrentActivations.map((response) => response.status())).toEqual([200, 200]);
	activationTables = await readTables();
	const activeReady = activationTables.filter((table) => table.is_active);
	expect(activeReady).toHaveLength(1);
	expect(activeReady[0].is_ok).toBe(true);
	expect([firstReady.name, secondReady.name]).toContain(activeReady[0].name);
	await page.reload();
	await expect(page.getByTestId("account-security")).toBeVisible();
	await dismissAdminTour(page);
	await expect(page.getByTestId("load-more-users")).toBeVisible();
	await page.getByTestId("load-more-users").click();
	await expect(page.getByTestId("user-fixture30")).toBeVisible();

	// A password is optional: sign out and complete a second magic-link login
	// while password_hash is still NULL.
	await page.getByRole("link", { name: /Logout/ }).click();
	await expect(page).toHaveURL(/login/);
	await signInByMagic(page, request, "migrated", "migrated.user@example.test");
	await expect(page.getByText("Users and invitations")).toBeVisible();
	await dismissAdminTour(page);
	await page.getByRole("link", { name: /Logout/ }).click();
	await expect(page).toHaveURL(/login/);

	// The ordinary forgot-password flow may establish a password for a NULL
	// account. Invalid-code and policy failures remain recoverable.
	await page.goto("/reset");
	await page.getByLabel("Username or email").fill("MIGRATED.USER@example.test");
	const beforeResetMail = await mailIDs(request);
	await page.getByRole("button", { name: "Send reset code" }).click();
	await expect(page.getByText("If the account exists, a reset code was requested. If it does not arrive, wait briefly and request another code.")).toBeVisible();
	const resetMail = await latestMail(request, "Reset your password", "migrated.user@example.test", beforeResetMail);
	const resetCode = String(resetMail.Text).match(/\b\d{6}\b/)?.[0];
	expect(resetCode).toBeTruthy();
	await page.getByLabel("Email code").fill("000000");
	await page.getByLabel("New password").fill("Migrated-New9!");
	await page.getByRole("button", { name: "Reset password" }).click();
	await expect(page.getByText("That code is invalid or expired. Check the code and try again, or request a new code.")).toBeVisible();
	await page.getByLabel("Email code").fill(resetCode!);
	await page.getByLabel("New password").fill("weak");
	await page.getByRole("button", { name: "Reset password" }).click();
	await expect(page.locator(".auth-card__error")).toBeVisible();
	await page.getByLabel("New password").fill("Migrated-New9!");
	await page.getByRole("button", { name: "Reset password" }).click();
	await expect(page).toHaveURL(/login/);

	// The optional password now uses the standard password + OTP journey.
	await page.getByLabel("Username or email").fill("migrated");
	await page.getByLabel("Password").fill("Migrated-New9!");
	const beforeLoginMail = await mailIDs(request);
	await page.getByRole("button", { name: "Login" }).click();
	await latestMail(request, "Your login code", "migrated.user@example.test", beforeLoginMail);
	await page.getByLabel("Email verification code").fill("000000");
	await page.getByRole("button", { name: "Verify code" }).click();
	await expect(page.getByText("That code is invalid or already used. Enter your password again to request a fresh code.")).toBeVisible();
	await expect(page.getByLabel("Username or email")).toHaveValue("migrated");
	await page.getByLabel("Password").fill("Migrated-New9!");
	const beforeFreshLoginMail = await mailIDs(request);
	await page.getByRole("button", { name: "Login" }).click();
	const freshLoginOTP = await latestMail(request, "Your login code", "migrated.user@example.test", beforeFreshLoginMail);
	const loginCode = String(freshLoginOTP.Text).match(/\b\d{6}\b/)?.[0];
	expect(loginCode).toBeTruthy();
	await page.getByLabel("Email verification code").fill(loginCode!);
	await page.getByRole("button", { name: "Verify code" }).click();
	await expect(page).toHaveURL(/admin/);
	await dismissAdminTour(page);
	// Let the five-second access token expire. Rendering this page must recover
	// through the frontend's single-flight rotating refresh rather than log out.
	const beforeExpiry = await page.evaluate(() => ({ access: localStorage.getItem("auth-token"), refresh: localStorage.getItem("auth-refresh-token"), device: localStorage.getItem("auth-device-id") }));
	let expiryRefreshes = 0;
	const countExpiryRefresh = (request: { url(): string }) => { if (request.url().endsWith("/auth/refresh")) expiryRefreshes += 1; };
	page.on("request", countExpiryRefresh);
	await waitForAccessExpiry(page);
	await page.reload();
	await expect(page.getByTestId("account-security")).toBeVisible();
	await expect(page.getByTestId("security-error")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => localStorage.getItem("auth-token"))).not.toBe(beforeExpiry.access);
	await expect.poll(() => expiryRefreshes).toBe(1);
	page.off("request", countExpiryRefresh);
	const refreshAfterExpiry = await page.evaluate(() => localStorage.getItem("auth-refresh-token"));
	expect(refreshAfterExpiry).not.toBe(beforeExpiry.refresh);
	const expiredReplay = await page.request.post("http://localhost:8081/auth/refresh", { data: { refresh_token: beforeExpiry.refresh, device_id: beforeExpiry.device } });
	expect(expiredReplay.status()).toBe(401);
	await expect(page.getByTestId("session-list").locator(`li[data-device-id="${beforeExpiry.device}"]`)).toBeVisible();

	// A temporary refresh outage must preserve credentials so a retry can
	// recover once auth-master is reachable again.
	const refreshBeforeOutage = await page.evaluate(() => localStorage.getItem("auth-refresh-token"));
	let outageRefreshes = 0;
	await page.route("**/auth/refresh", async (route) => {
		outageRefreshes += 1;
		await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"temporary"}' });
	});
	await waitForAccessExpiry(page);
	await page.reload();
	await expect(page.getByTestId("security-error")).toBeVisible();
	expect(outageRefreshes).toBeGreaterThanOrEqual(1);
	await expect(page).toHaveURL(/\/admin/);
	expect(await page.evaluate(() => localStorage.getItem("auth-refresh-token"))).toBe(refreshBeforeOutage);
	await page.unroute("**/auth/refresh");
	await page.reload();
	await expect(page.getByTestId("security-error")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => localStorage.getItem("auth-refresh-token"))).not.toBe(refreshBeforeOutage);

	// Create a second root session in an isolated cookie jar, then revoke that
	// device through the visible session list and prove its refresh is dead.
	const secondary = await playwrightRequest.newContext();
	let secondaryRefresh = "";
	try {
		const beforeSecondaryMail = await mailIDs(request);
		const secondaryLogin = await secondary.post("http://localhost:8081/auth/login", { form: { uname_or_email: "migrated", password: "Migrated-New9!" } });
		expect(secondaryLogin.status()).toBe(200);
		const secondaryChallenge = (await secondaryLogin.json()).login_challenge;
		const secondaryMail = await latestMail(request, "Your login code", "migrated.user@example.test", beforeSecondaryMail);
		const secondaryCode = String(secondaryMail.Text).match(/\b\d{6}\b/)?.[0];
		const secondaryVerify = await secondary.post("http://localhost:8081/auth/login-verify-otp", { form: { challenge: secondaryChallenge, code: secondaryCode!, device_id: "root-secondary" } });
		expect(secondaryVerify.status()).toBe(200);
		secondaryRefresh = (await secondaryVerify.json()).refresh_token;
		await page.reload();
		const secondarySession = page.getByTestId("session-list").locator('li[data-device-id="root-secondary"]');
		await expect(secondarySession).toBeVisible();
		await secondarySession.getByRole("button", { name: "Revoke" }).click();
		await expect(secondarySession).toContainText("revoked");
		const revokedRefresh = await secondary.post("http://localhost:8081/auth/refresh", { data: { refresh_token: secondaryRefresh, device_id: "root-secondary" } });
		expect(revokedRefresh.status()).toBe(401);
	} finally {
		await secondary.dispose();
	}

	// Superuser management is exercised through the application UI: create an
	// invitation, register from its link, list the new user, and grant admin.
	await page.getByTestId("invite-email").fill("SECOND@example.test");
	await page.getByTestId("create-invite").click();
	const registrationURL = await page.getByTestId("security-notice").textContent();
	expect(registrationURL).toMatch(/\/register\?token=/);
	const inviteeContext = await browser.newContext();
	const inviteePage = await inviteeContext.newPage();
	await inviteePage.goto(registrationURL!);
	await expect(inviteePage).toHaveURL(/\/register\?token=/);
	await expect(inviteePage.getByRole("heading", { name: "Create account" })).toBeVisible();
	await inviteePage.getByLabel("Login").fill("second");
	await expect(inviteePage.getByLabel("Email")).toHaveValue("SECOND@example.test");
	await inviteePage.getByLabel("Password").fill("Second-User9!");
	await inviteePage.getByRole("button", { name: "Register" }).click();
	await expect(inviteePage).toHaveURL(/login/);
	await inviteeContext.close();
	await page.reload();
	await page.getByTestId("user-search").fill("second");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.getByTestId("user-second")).toBeVisible();
	await page.getByTestId("grant-admin-second").click();
	await expect(page.getByTestId("security-notice")).toHaveText("Granted admin to second");

	// The same public reset journey replaces an existing forgotten password.
	const resetContext = await browser.newContext();
	const resetPage = await resetContext.newPage();
	const beforeExistingReset = await mailIDs(request);
	await resetPage.goto("/reset");
	await resetPage.getByLabel("Username or email").fill("SECOND@example.test");
	await resetPage.getByRole("button", { name: "Send reset code" }).click();
	await expect(resetPage.getByText("If the account exists, a reset code was requested. If it does not arrive, wait briefly and request another code.")).toBeVisible();
	const existingResetMail = await latestMail(request, "Reset your password", "second@example.test", beforeExistingReset);
	const existingResetCode = String(existingResetMail.Text).match(/\b\d{6}\b/)?.[0];
	expect(existingResetCode).toBeTruthy();
	await resetPage.getByLabel("Email code").fill(existingResetCode!);
	await resetPage.getByLabel("New password").fill("Second-Reset9!");
	await resetPage.getByRole("button", { name: "Reset password" }).click();
	await expect(resetPage).toHaveURL(/login/);
	await resetContext.close();

	// Rotation makes the current access token stale. The next UI mutation must
	// transparently refresh and retry, then the same control unbans the user.
	await page.getByTestId("rotate-signing-key").click();
	await expect(page.getByTestId("security-notice")).toHaveText("Signing key rotated");
	// Count only recovery from the signing-key mutation. If the short-lived
	// access token expires while authorizing rotation, that precondition refresh
	// is complete before this listener and cannot mutate the assertion.
	const accessBeforeRotationRecovery = await page.evaluate(() => localStorage.getItem("auth-token"));
	const refreshBeforeRotationRecovery = await page.evaluate(() => localStorage.getItem("auth-refresh-token"));
	let rotationRefreshes = 0;
	const countRefresh = (request: { url(): string }) => { if (request.url().endsWith("/auth/refresh")) rotationRefreshes += 1; };
	page.on("request", countRefresh);
	await page.getByTestId("ban-second").click();
	await expect(page.getByTestId("ban-second")).toHaveText("Unban");
	await expect.poll(() => page.evaluate(() => localStorage.getItem("auth-token"))).not.toBe(accessBeforeRotationRecovery);
	await expect.poll(() => rotationRefreshes).toBe(1);
	page.off("request", countRefresh);
	const refreshAfterRotation = await page.evaluate(() => localStorage.getItem("auth-refresh-token"));
	expect(refreshAfterRotation).not.toBe(refreshBeforeRotationRecovery);
	const rotationReplay = await page.request.post("http://localhost:8081/auth/refresh", { data: { refresh_token: refreshBeforeRotationRecovery, device_id: beforeExpiry.device } });
	expect(rotationReplay.status()).toBe(401);
	await page.getByTestId("ban-second").click();
	await expect(page.getByTestId("ban-second")).toHaveText("Ban");

	const currentAuth = await page.evaluate(() => ({ access: localStorage.getItem("auth-token")!, refresh: localStorage.getItem("auth-refresh-token")!, csrf: localStorage.getItem("auth-csrf-token")! }));
	const activeHeaders = { Authorization: `Bearer ${currentAuth.access}`, "X-CSRF-Token": currentAuth.csrf };
	const users = await page.request.get("http://localhost:8081/auth/admin/users?q=second&page_size=25", { headers: activeHeaders });
	const usersBody = await users.json(); const second = usersBody.users.find((u: { login: string }) => u.login === "second"); expect(second).toBeTruthy();
	const adminRole = await findExactRole(page.request, activeHeaders, "admin");

	// Only the superuser surface may assign roles, even when another user is an admin.
	const adminContext = await playwrightRequest.newContext();
	const beforeSecondMail = await mailIDs(request); const secondLogin = await adminContext.post("http://localhost:8081/auth/login", { form: { uname_or_email: "second", password: "Second-Reset9!" } }); const challenge = (await secondLogin.json()).login_challenge;
	const secondMail = await latestMail(request, "Your login code", "second@example.test", beforeSecondMail); const secondCode = String(secondMail.Text).match(/\b\d{6}\b/)?.[0];
	const secondVerify = await adminContext.post("http://localhost:8081/auth/login-verify-otp", { form: { challenge, code: secondCode!, device_id: "second-e2e" } }); const secondTokens = await secondVerify.json();
	const forbiddenGrant = await adminContext.post(`http://localhost:8081/auth/admin/roles/${adminRole.id}/members`, { headers: { Authorization: `Bearer ${secondTokens.access_token}`, "X-CSRF-Token": secondTokens.csrf_token }, data: { user_id: second.id, level: "member" } }); expect(forbiddenGrant.status()).toBe(403);
	await adminContext.dispose();


	// Hold a successful refresh response after auth-master has rotated the
	// server credential, then log out. The logout barrier must revoke both the
	// old credential and the held winner without resurrecting browser storage.
	await waitForAccessExpiry(page);
	const refreshBeforeLogout = await page.evaluate(() => localStorage.getItem("auth-refresh-token")!);
	let releaseRefresh!: () => void;
	const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
	let refreshReachedServer!: () => void;
	const refreshAtServer = new Promise<void>((resolve) => { refreshReachedServer = resolve; });
	let rotatedRefresh = "";
	await page.route("**/auth/refresh", async (route) => {
		const upstream = await route.fetch();
		expect(upstream.status()).toBe(200);
		rotatedRefresh = String((await upstream.json()).refresh_token ?? "");
		refreshReachedServer();
		await refreshGate;
		await route.fulfill({ response: upstream });
	});
	await page.getByTestId("user-search").fill("second");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await refreshAtServer;
	expect(rotatedRefresh).not.toBe("");
	let logoutRequests = 0;
	const logoutStatuses: number[] = [];
	const countLogout = (request: { url(): string }) => { if (request.url().endsWith("/auth/logout")) logoutRequests += 1; };
	const collectLogoutStatus = (response: { url(): string; status(): number }) => {
		if (response.url().endsWith("/auth/logout")) logoutStatuses.push(response.status());
	};
	page.on("request", countLogout);
	page.on("response", collectLogoutStatus);
	const oldLogoutResponse = page.waitForResponse((response) => response.url().endsWith("/auth/logout"));
	await page.getByRole("link", { name: /Logout/ }).click();
	expect((await oldLogoutResponse).status()).toBe(204);
	releaseRefresh();
	await expect(page).toHaveURL(/login/);
	await expect.poll(() => logoutRequests).toBe(2);
	await expect.poll(() => logoutStatuses).toEqual([204, 204]);
	page.off("request", countLogout);
	page.off("response", collectLogoutStatus);
	await page.unroute("**/auth/refresh");
	await expect.poll(() => page.evaluate(() => ({
		access: localStorage.getItem("auth-token"),
		refresh: localStorage.getItem("auth-refresh-token"),
		csrf: localStorage.getItem("auth-csrf-token"),
	}))).toEqual({ access: null, refresh: null, csrf: null });
	const oldLogoutReplay = await page.request.post("http://localhost:8081/auth/refresh", { data: { refresh_token: refreshBeforeLogout, device_id: beforeExpiry.device } });
	expect(oldLogoutReplay.status()).toBe(401);
	const rotatedLogoutReplay = await page.request.post("http://localhost:8081/auth/refresh", { data: { refresh_token: rotatedRefresh, device_id: beforeExpiry.device } });
	expect(rotatedLogoutReplay.status()).toBe(401);
});

test("legacy access-only storage is cleared into a usable login page", async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem("auth-token", "eyJhbGciOiJub25lIn0.eyJleHAiOjEsImxvZ2luIjoibGVnYWN5In0.");
		localStorage.setItem("name", "legacy");
		localStorage.setItem("auth-csrf-token", "legacy-csrf");
		localStorage.setItem("auth-device-id", "stable-browser-device");
	});
	await page.goto("/login");
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
	await expect.poll(() => page.evaluate(() => ({
		access: localStorage.getItem("auth-token"),
		refresh: localStorage.getItem("auth-refresh-token"),
		csrf: localStorage.getItem("auth-csrf-token"),
		name: localStorage.getItem("name"),
		device: localStorage.getItem("auth-device-id"),
	}))).toEqual({ access: null, refresh: null, csrf: null, name: null, device: "stable-browser-device" });
});

test("magic callback shows progress and actionable invalid-link recovery", async ({ page }) => {
	let releaseConfirmation!: () => void;
	const confirmationGate = new Promise<void>((resolve) => {
		releaseConfirmation = resolve;
	});
	await page.route("**/auth/confirm-login-mail", async (route) => {
		await confirmationGate;
		await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"invalid"}' });
	});
	await page.goto("/admit?token=invalid-token");
	await expect(page.getByRole("status")).toHaveText("Signing you in…");
	releaseConfirmation();
	await expect(page.getByText("This sign-in link is invalid or has already been used.")).toBeVisible();
	await expect(page.getByRole("link", { name: "Request a fresh sign-in link" })).toHaveAttribute("href", "/login");
});

test("magic start hides delivery failure for known and unknown identities", async ({ page }) => {
	test.skip(process.env.VERIFY_SMTP_FAILURE !== "1", "runs with Mailpit stopped by the Make-managed E2E harness");
	await page.goto("/login");
	await page.getByRole("button", { name: "Log in by mail" }).click();
	const input = page.getByLabel("Username or email");
	const submit = page.getByRole("button", { name: "Send login link" });
	const acknowledgements: string[] = [];
	for (const identity of ["unknown-delivery-user", "migrated"]) {
		await input.fill(identity);
		const responsePromise = page.waitForResponse((response) => response.url().endsWith("/auth/login-mail") && response.request().method() === "POST");
		await submit.click();
		const response = await responsePromise;
		expect(response.status()).toBe(200);
		const notice = page.getByText("If the account exists, a sign-in link was requested. If it does not arrive, wait briefly and request another link.");
		await expect(notice).toBeVisible();
		acknowledgements.push((await notice.textContent()) ?? "");
	}
	expect(acknowledgements[1]).toBe(acknowledgements[0]);
});

test("repaired imported memberships restore browser authority", async ({ page, request }) => {
	test.skip(process.env.VERIFY_REPAIRED_MEMBERSHIP !== "1", "runs after the importer membership-repair rerun");
	await page.goto("/login");
	await page.getByLabel("Username or email").fill("migrated");
	await page.getByLabel("Password").fill("Migrated-New9!");
	const beforeLoginMail = await mailIDs(request);
	await page.getByRole("button", { name: "Login" }).click();
	const loginOTP = await latestMail(request, "Your login code", "migrated.user@example.test", beforeLoginMail);
	const loginCode = String(loginOTP.Text).match(/\b\d{6}\b/)?.[0];
	await page.getByLabel("Email verification code").fill(loginCode!);
	await page.getByRole("button", { name: "Verify code" }).click();
	await expect(page.getByText("Users and invitations")).toBeVisible();
	await dismissAdminTour(page);
	await uploadTableThroughUI(page, "repaired-membership-authority");
});

test("public scientific search builds queries, groups domain results, and anonymous mutations are denied", async ({ page, request }) => {
	const metadata = [
		{ column: "species", name: "Species", description: "Scientific species", type: "table_specie keycolumn search" },
		{ column: "chemical", name: "Chemical", description: "Furanocoumarin", type: "table_chemical keycolumn search" },
		{ column: "smiles", name: "SMILES", description: "Structure", type: "table_chemical smiles" },
		{ column: "safe_source", name: "Safe source", description: "Safe link", type: "table_chemical link[https://example.test/articles/%s]" },
		{ column: "dangerous_source", name: "Dangerous source", description: "Unsafe legacy link", type: "table_chemical link[javascript:%s]" },
		{ column: "authority_source", name: "Authority source", description: "Unsafe variable authority", type: "table_chemical link[https://%s.example.test/path]" },
		{ column: "references", name: "References", description: "Literature", type: "table_ ref[]" },
	];
	let capturedQuery = "";
	await page.route("**/metadata", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ metadata }) }));
	await page.route("**/autocomplete/species?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"values":["Ruta graveolens"]}' }));
	await page.route("**/search?*", (route) => {
		capturedQuery = new URL(route.request().url()).searchParams.get("q") ?? "";
		return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ metadata, data: [
			{ species: "Ruta graveolens", chemical: "Bergapten", smiles: "COC1=CC2=C(C=C1)C(=O)OC2", safe_source: "ref-a, case report 1, line\nbreak, ../logout?admin#x", dangerous_source: "alert(1)", authority_source: "evil", references: "ref-a, ref-b" },
			{ species: "Ruta graveolens", chemical: "Xanthotoxin", smiles: "COC1=CC2=COC(=O)C2=C1", safe_source: "ref-c", dangerous_source: "alert(1)", authority_source: "evil", references: "ref-c" },
			{ species: "Citrus limon", chemical: "Bergapten", smiles: "COC1=CC2=C(C=C1)C(=O)OC2", safe_source: "ref-a, case report 1, line\nbreak, ../logout?admin#x", dangerous_source: "alert(1)", authority_source: "evil", references: "ref-a, ref-b" },
		] }) });
	});
	await page.goto("/search");
	await dismissAdminTour(page);
	await page.getByRole("button", { name: /Species/ }).click();
	const speciesInput = page.locator('[data-tour="search-autocomplete"] input');
	await speciesInput.fill("Ruta");
	await page.getByText("Ruta graveolens", { exact: true }).click();
	await page.getByRole("button", { name: /Search/ }).click();
	await expect.poll(() => capturedQuery).toBe("species = 'Ruta graveolens'");
	await dismissAdminTour(page);
	const resultToolbar = page.locator('[data-tour="table-toolbar"]');
	await expect(resultToolbar.getByText("Chemical (2)", { exact: true })).toBeVisible();
	await expect(resultToolbar.getByText("Species (2)", { exact: true })).toBeVisible();
	await expect(resultToolbar.getByText("Reference (3)", { exact: true })).toBeVisible();
	const chemicalPanel = page.locator('[data-tour="table-chemical-panel"]');
	const speciesPanel = page.locator('[data-tour="table-species-panel"]');
	const centralResults = page.locator('[data-tour="table-results"]');
	await expect(centralResults.getByText("Select species or chemical", { exact: true })).toBeVisible();
	await expect(chemicalPanel.getByText("Xanthotoxin", { exact: true })).toBeVisible();
	await chemicalPanel.getByRole("button", { name: /Bergapten/ }).click();
	await expect(chemicalPanel.getByText("Bergapten", { exact: true })).toBeVisible();
	await expect(chemicalPanel.getByRole("link", { name: "ref-a", exact: true })).toHaveAttribute("href", "https://example.test/articles/ref-a");
	await expect(chemicalPanel.getByRole("link", { name: "case report 1", exact: true })).toHaveAttribute("href", "https://example.test/articles/case%20report%201");
	await expect(chemicalPanel.getByText(/line\s+break/)).toBeVisible();
	await expect(chemicalPanel.locator('a[href*="line"]')).toHaveCount(0);
	await expect(chemicalPanel.getByRole("link", { name: "../logout?admin#x", exact: true })).toHaveAttribute("href", "https://example.test/articles/..%2Flogout%3Fadmin%23x");
	await expect(chemicalPanel.getByText("alert(1)", { exact: true })).toBeVisible();
	await expect(chemicalPanel.getByText("evil", { exact: true })).toBeVisible();
	await expect(chemicalPanel.locator('a[href^="javascript:"]')).toHaveCount(0);
	await expect(chemicalPanel.locator('a[href="https://evil.example.test/path"]')).toHaveCount(0);
	await expectScientificRowSet(centralResults, ["Ruta graveolens/Bergapten", "Citrus limon/Bergapten"]);
	await expect(centralResults.getByRole("button", { name: "ref-a", exact: true })).toHaveCount(2);
	await expect(centralResults.getByRole("button", { name: "ref-b", exact: true })).toHaveCount(2);
	await expect(centralResults.getByRole("button", { name: "ref-c", exact: true })).toHaveCount(0);
	await expect(resultToolbar.getByText(/Rows in selection:\s*2/)).toBeVisible();
	await expect(resultToolbar.getByText("Chemical (1)", { exact: true })).toBeVisible();
	await expect(resultToolbar.getByText("Reference (2)", { exact: true })).toBeVisible();
	await expect(resultToolbar.getByText("Reference (3)", { exact: true })).toHaveCount(0);
	await speciesPanel.getByRole("button", { name: /Ruta graveolens/ }).click();
	await expectScientificRowSet(centralResults, ["Ruta graveolens/Bergapten"]);
	await expect(centralResults.getByRole("button", { name: "ref-a", exact: true })).toHaveCount(1);
	await expect(centralResults.getByRole("button", { name: "ref-b", exact: true })).toHaveCount(1);
	await expect(centralResults.getByRole("button", { name: "ref-c", exact: true })).toHaveCount(0);
	await expect(resultToolbar.getByText(/Rows in selection:\s*1/)).toBeVisible();
	await expect(chemicalPanel.getByText("Xanthotoxin", { exact: true })).toHaveCount(0);
	await expect(chemicalPanel.getByRole("link", { name: "Open substance page" })).toHaveAttribute("href", /\/page\?smiles=/);
	await speciesPanel.getByRole("button", { name: "Back to list" }).click();
	await expectScientificRowSet(centralResults, ["Ruta graveolens/Bergapten", "Citrus limon/Bergapten"]);
	await expect(centralResults.getByRole("button", { name: "ref-a", exact: true })).toHaveCount(2);
	await expect(centralResults.getByRole("button", { name: "ref-b", exact: true })).toHaveCount(2);
	await expect(centralResults.getByRole("button", { name: "ref-c", exact: true })).toHaveCount(0);
  const denied = await request.delete("http://localhost:8081/tables");
  expect(denied.status()).toBe(401);
});

test("scientific grouping keeps delimiter-collision tuples distinct", async ({ page }) => {
	const metadata = [
		{ column: "species", name: "Species", description: "Species", type: "table_specie keycolumn search" },
		{ column: "chemical", name: "Chemical", description: "Chemical", type: "table_chemical keycolumn search" },
		{ column: "references", name: "References", description: "Literature", type: "table_ ref[]" },
	];
	await page.route("**/metadata", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ metadata }) }));
	await page.route("**/autocomplete/species?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"values":["c"]}' }));
	await page.route("**/search?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ metadata, data: [
		{ chemical: "ab", species: "c", references: "same-ref" },
		{ chemical: "a", species: "bc", references: "same-ref" },
	] }) }));
	await page.goto("/search");
	await dismissAdminTour(page);
	await page.getByRole("button", { name: /Species/ }).click();
	const speciesInput = page.locator('[data-tour="search-autocomplete"] input');
	await speciesInput.fill("c");
	await page.getByText("c", { exact: true }).click();
	await page.getByRole("button", { name: /Search/ }).click();
	await dismissAdminTour(page);
	const toolbar = page.locator('[data-tour="table-toolbar"]');
	await expect(toolbar.getByText("Chemical (2)", { exact: true })).toBeVisible();
	await expect(toolbar.getByText("Species (2)", { exact: true })).toBeVisible();
	const chemicalPanel = page.locator('[data-tour="table-chemical-panel"]');
	await chemicalPanel.getByRole("button", { name: /^\d+\. ab species: \d+$/ }).click();
	await expectScientificRowSet(page.locator('[data-tour="table-results"]'), ["c/ab"]);
	await chemicalPanel.getByRole("button", { name: "Back to list" }).click();
	await chemicalPanel.getByRole("button", { name: /^\d+\. a species: \d+$/ }).click();
	await expectScientificRowSet(page.locator('[data-tour="table-results"]'), ["bc/a"]);
});
