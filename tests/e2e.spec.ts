import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// End-to-end suite: UI flows (auth, warehouse switcher, dashboard, products, transfers,
// orders, reservations, API keys) and the public API.
// Test users are e2e-<timestamp>@test.local; remove their data with `npm run test:cleanup`.
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const user = { name: "E2E Tester", email: `e2e-${stamp}@test.local`, password: "e2e-password-123" };
let apiKey = "";
let uiOrderCode = "";

type WH = "KDY" | "PLG";
const UI_PRODUCT = "C32_STYLE_010";
const UI_RES_PRODUCT = "C32_STYLE_011";
const API_PRODUCT = "C32_TECH_050";
const API_PRODUCT_2 = "C32_FRESH_020";

// Direct DB access is only used to fast-forward a reservation's expiry. Locally it uses .env;
// against a deployed site it needs that site's DB env (TURSO_*), otherwise the test is skipped.
const remote = !!process.env.BASE_URL;
const canUseDb = remote ? !!process.env.TURSO_DATABASE_URL : true;

async function login(page: Page, email = user.email, password = user.password, expectSuccess = true) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the redirect so a following page.goto() doesn't abort the sign-in.
  if (expectSuccess) await expect(page).toHaveURL(/\/dashboard$/);
}

const api = (request: APIRequestContext, key = apiKey) => ({
  get: (path: string) => request.get(`/api/v1${path}`, { headers: { "x-api-key": key } }),
  send: (method: "POST" | "PUT" | "PATCH", path: string, data?: unknown) =>
    request.fetch(`/api/v1${path}`, { method, headers: { "x-api-key": key }, data }),
});

async function stockOf(request: APIRequestContext, id: string, wh: WH): Promise<{ available: number; reserved: number }> {
  const res = await api(request).get(`/products/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data.stock[wh];
}
const availableOf = async (request: APIRequestContext, id: string, wh: WH) => (await stockOf(request, id, wh)).available;

// UI helpers (products table cells are tagged with data-product / data-warehouse)
const stockButton = (page: Page, id: string, wh: WH) => page.locator(`tr[data-product="${id}"] td[data-warehouse="${wh}"] button`).first();
const readStock = async (page: Page, id: string, wh: WH) => Number((await stockButton(page, id, wh).textContent())!.replace(/\D/g, ""));
async function setStockUI(page: Page, id: string, wh: WH, value: number) {
  const cell = page.locator(`tr[data-product="${id}"] td[data-warehouse="${wh}"]`);
  await stockButton(page, id, wh).click();
  await cell.locator('input[name="stock"]').fill(String(value));
  await cell.getByRole("button", { name: "Save" }).click();
  await expect(stockButton(page, id, wh)).toHaveText(value.toLocaleString("en-US"));
}
async function selectWarehouse(page: Page, value: "" | WH) {
  await page.locator("#warehouse-switcher").selectOption(value);
  await expect(page.locator("#warehouse-switcher")).toHaveValue(value);
}
async function placeOrderUI(page: Page, wh: WH, lines: [string, number][]) {
  await page.goto("/orders/new");
  await page.locator("#order-warehouse").selectOption(wh);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.getByRole("button", { name: "+ Add line" }).click();
    await page.getByPlaceholder("e.g. C32_TECH_001").nth(i).fill(lines[i][0]);
    await page.locator('input[type="number"]').nth(i).fill(String(lines[i][1]));
  }
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/ORD\d{7}$/);
  return page.url().split("/").pop()!;
}

// ---------------------------------------------------------------- auth

test.describe("auth", () => {
  test("signed-out user is redirected to /login", async ({ page }) => {
    for (const path of ["/", "/dashboard", "/products", "/orders", "/api-keys", "/docs"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("register validates input", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("x");
    await page.getByLabel("Email").fill(`short-${stamp}@test.local`);
    // Bypass the browser's minLength check to exercise server-side validation.
    await page.getByLabel("Password").evaluate((el) => el.removeAttribute("minlength"));
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
  });

  test("register creates account and signs in", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("duplicate email is rejected", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("Dup");
    await page.getByLabel("Email").fill(user.email.toUpperCase()); // emails are case-insensitive
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText("Email is already registered")).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    await login(page, user.email, "wrong-password", false);
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login, signed-in redirect away from /login, logout", async ({ page }) => {
    await login(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("demo user can log in", async ({ page }) => {
    await login(page, "demo@warehouse.local", "demo1234");
  });
});

// ---------------------------------------------------------------- UI pages

test.describe("dashboard, warehouses, products, orders UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard shows stats, charts and both warehouses", async ({ page }) => {
    await expect(page.getByText("All warehouses overview")).toBeVisible();
    for (const label of ["Units available", "Orders", "Awaiting confirmation", "Units ordered", "Low stock"]) {
      await expect(page.locator(".card .muted.text-xs", { hasText: new RegExp(`^${label}$`) }).first()).toBeVisible();
    }
    for (const name of ["Kandy", "Peliyagoda"]) await expect(page.locator(".card .font-medium", { hasText: new RegExp(`^${name}$`) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Orders per month" })).toBeVisible();
    expect(await page.locator(".chart-col").count()).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Units ordered by brand" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent orders" })).toBeVisible();
  });

  test("warehouse switcher scopes dashboard and orders", async ({ page }) => {
    await selectWarehouse(page, "KDY");
    await expect(page.getByText("Kandy overview")).toBeVisible();

    await page.goto("/orders");
    await expect(page.getByText("Kandy warehouse")).toBeVisible();
    const kdy = await page.locator("tbody td:nth-child(2)").allTextContents();
    expect(kdy.length).toBeGreaterThan(0);
    expect(new Set(kdy)).toEqual(new Set(["Kandy"]));

    await selectWarehouse(page, "PLG");
    await expect(page.getByText("Peliyagoda warehouse")).toBeVisible();
    await expect(page.locator("tbody td:nth-child(2)").first()).toHaveText("Peliyagoda");
    const plg = await page.locator("tbody td:nth-child(2)").allTextContents();
    expect(new Set(plg)).toEqual(new Set(["Peliyagoda"]));

    await selectWarehouse(page, "");
    await page.goto("/dashboard");
    await expect(page.getByText("All warehouses overview")).toBeVisible();
  });

  test("products: search, brand filter, sort, paging", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByText("280 results")).toBeVisible();
    await expect(page.locator("thead th", { hasText: "Kandy" })).toBeVisible();
    await expect(page.locator("thead th", { hasText: "Peliyagoda" })).toBeVisible();

    await page.getByPlaceholder("Search product ID").fill("tech_00");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("9 results")).toBeVisible(); // C32_TECH_001..009
    await expect(page.locator("tbody tr")).toHaveCount(9);

    await page.goto("/products?brand=Style");
    await expect(page.getByText("47 results")).toBeVisible();
    await expect(page.locator("tbody td:nth-child(2)").first()).toHaveText("Style");

    await page.goto("/products?sort=stock"); // All warehouses: sorted by total
    const totals = (await page.locator("tbody td:nth-child(7)").allTextContents()).map((s) => Number(s.replace(/\D/g, "")));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));

    await page.goto("/products");
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("page 2 of 12")).toBeVisible();
  });

  test("products: edit stock per warehouse", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const kdy = await readStock(page, UI_PRODUCT, "KDY");
    const plg = await readStock(page, UI_PRODUCT, "PLG");

    await setStockUI(page, UI_PRODUCT, "KDY", kdy + 7);
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText(plg.toLocaleString("en-US")); // other warehouse untouched
    await setStockUI(page, UI_PRODUCT, "KDY", kdy); // restore
  });

  test("products: transfer between warehouses", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const row = page.locator(`tr[data-product="${UI_PRODUCT}"]`);
    const kdy = await readStock(page, UI_PRODUCT, "KDY");
    const plg = await readStock(page, UI_PRODUCT, "PLG");

    await row.getByRole("button", { name: "Transfer" }).click();
    await row.getByLabel("Transfer from").selectOption("KDY");
    await row.getByLabel("Transfer quantity").fill("10");
    await row.getByRole("button", { name: "Move" }).click();
    await expect(stockButton(page, UI_PRODUCT, "KDY")).toHaveText((kdy - 10).toLocaleString("en-US"));
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText((plg + 10).toLocaleString("en-US"));

    // too many -> error, nothing moved
    await row.getByRole("button", { name: "Transfer" }).click();
    await row.getByLabel("Transfer from").selectOption("KDY");
    await row.getByLabel("Transfer quantity").fill(String(kdy + 1000));
    await row.getByRole("button", { name: "Move" }).click();
    await expect(row.getByText(/only .* available in Kandy/)).toBeVisible();
    await row.getByRole("button", { name: "Cancel transfer" }).click();

    // move back
    await row.getByRole("button", { name: "Transfer" }).click();
    await row.getByLabel("Transfer from").selectOption("PLG");
    await row.getByLabel("Transfer quantity").fill("10");
    await row.getByRole("button", { name: "Move" }).click();
    await expect(stockButton(page, UI_PRODUCT, "KDY")).toHaveText(kdy.toLocaleString("en-US"));
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText(plg.toLocaleString("en-US"));
  });

  test("orders: filter, search, detail shows warehouse", async ({ page }) => {
    await page.goto("/orders?status=delivered");
    await expect(page.locator("tbody tr").first()).toContainText("delivered");

    await page.goto("/orders");
    await page.getByPlaceholder("Search order ID").fill("ORD0000001");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: "ORD0000001", exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/ORD0000001$/);
    await expect(page.getByRole("heading", { name: "ORD0000001" })).toBeVisible();
    await expect(page.getByText("Kandy warehouse")).toBeVisible(); // odd seeded order numbers are Kandy
    await expect(page.getByRole("cell", { name: "C32_FRESH_019" })).toBeVisible();
    await expect(page.getByText("No further status changes.")).toBeVisible();

    await page.goto("/orders/ORD0000002");
    await expect(page.getByText("Peliyagoda warehouse")).toBeVisible();

    await page.goto("/orders/NOPE123");
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });

  test("orders: new order form validates", async ({ page }) => {
    await page.goto("/orders/new");
    await page.getByPlaceholder("e.g. C32_TECH_001").fill("NOT_A_PRODUCT");
    await expect(page.getByText("Unknown product")).toBeVisible();
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Unknown product(s): NOT_A_PRODUCT")).toBeVisible();
  });

  test("orders: Kandy order takes Kandy stock only; ship, deliver", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const kdy = await readStock(page, UI_PRODUCT, "KDY");
    const plg = await readStock(page, UI_PRODUCT, "PLG");

    await page.goto("/orders/new");
    await page.locator("#order-warehouse").selectOption("KDY");
    await page.getByPlaceholder("e.g. C32_TECH_001").fill(UI_PRODUCT);
    await page.locator('input[type="number"]').fill("3");
    await page.getByRole("button", { name: "+ Add line" }).click();
    await page.getByPlaceholder("e.g. C32_TECH_001").nth(1).fill(UI_PRODUCT); // duplicate line gets merged
    await page.locator('input[type="number"]').nth(1).fill("2");
    await expect(page.getByText(/^5 units/)).toBeVisible();
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/ORD\d{7}$/);
    uiOrderCode = page.url().split("/").pop()!;
    await expect(page.locator(".badge", { hasText: "pending" })).toBeVisible();
    await expect(page.getByText("Kandy warehouse")).toBeVisible();
    await expect(page.getByText(`ui · ${user.email}`)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr td").nth(3)).toHaveText("5");

    await page.getByRole("button", { name: "Mark shipped" }).click();
    await expect(page.locator(".badge", { hasText: "shipped" })).toBeVisible();
    await page.getByRole("button", { name: "Mark delivered" }).click();
    await expect(page.locator(".badge", { hasText: "delivered" })).toBeVisible();

    await page.goto(`/products?q=${UI_PRODUCT}`);
    await expect(stockButton(page, UI_PRODUCT, "KDY")).toHaveText((kdy - 5).toLocaleString("en-US"));
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText(plg.toLocaleString("en-US"));
  });

  test("orders: Peliyagoda order, cancel returns stock to Peliyagoda", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const kdy = await readStock(page, UI_PRODUCT, "KDY");
    const plg = await readStock(page, UI_PRODUCT, "PLG");

    await placeOrderUI(page, "PLG", [[UI_PRODUCT, 4]]);
    await expect(page.getByText("Peliyagoda warehouse")).toBeVisible();
    await page.goto(`/products?q=${UI_PRODUCT}`);
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText((plg - 4).toLocaleString("en-US"));
    await expect(stockButton(page, UI_PRODUCT, "KDY")).toHaveText(kdy.toLocaleString("en-US"));

    await page.goBack();
    await expect(page.getByText("Cancelling returns the units to Peliyagoda stock.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.locator(".badge", { hasText: "cancelled" })).toBeVisible();

    await page.goto(`/products?q=${UI_PRODUCT}`);
    await expect(stockButton(page, UI_PRODUCT, "PLG")).toHaveText(plg.toLocaleString("en-US"));
  });

  test("reservation: short stock is locked, then confirmed as partial order", async ({ page }) => {
    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    const original = await readStock(page, UI_RES_PRODUCT, "KDY");
    await setStockUI(page, UI_RES_PRODUCT, "KDY", 5);

    const code = await placeOrderUI(page, "KDY", [[UI_RES_PRODUCT, 8]]);
    const panel = page.getByTestId("reservation-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator(".badge", { hasText: "awaiting confirmation" })).toBeVisible();
    await expect(panel).toContainText("Not enough stock in Kandy");
    await expect(panel).toContainText("5 of 8 units are locked");
    await expect(panel.locator("tbody tr td").nth(3)).toHaveText("3"); // short
    await expect(panel).toContainText(/Peliyagoda has [\d,]+/);
    await expect(page.getByTestId("countdown")).toHaveText(/^\d+:\d\d$/);

    // locked units are not available to anyone else
    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    await expect(stockButton(page, UI_RES_PRODUCT, "KDY")).toHaveText("0");
    await expect(page.locator(`tr[data-product="${UI_RES_PRODUCT}"] td[data-warehouse="KDY"]`)).toContainText("5 locked");

    await page.goto(`/orders/${code}`);
    await page.getByRole("button", { name: /Confirm partial order/ }).click();
    await expect(page.locator(".badge", { hasText: "pending" })).toBeVisible();
    await expect(page.getByTestId("reservation-panel")).toHaveCount(0);
    await expect(page.locator("tbody tr td").nth(2)).toHaveText("8"); // requested
    await expect(page.locator("tbody tr td").nth(3)).toHaveText("5"); // fulfilled

    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    await expect(stockButton(page, UI_RES_PRODUCT, "KDY")).toHaveText("0");
    await expect(page.locator(`tr[data-product="${UI_RES_PRODUCT}"] td[data-warehouse="KDY"]`)).not.toContainText("locked");

    // clean up: cancel the order (returns 5) and restore the original stock
    await page.goto(`/orders/${code}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.locator(".badge", { hasText: "cancelled" })).toBeVisible();
    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    await expect(stockButton(page, UI_RES_PRODUCT, "KDY")).toHaveText("5");
    await setStockUI(page, UI_RES_PRODUCT, "KDY", original);
  });

  test("reservation: cancel releases locked stock", async ({ page }) => {
    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    const original = await readStock(page, UI_RES_PRODUCT, "PLG");
    await setStockUI(page, UI_RES_PRODUCT, "PLG", 2);

    await placeOrderUI(page, "PLG", [[UI_RES_PRODUCT, 6]]);
    await expect(page.getByTestId("reservation-panel")).toContainText("2 of 6 units are locked");
    await page.getByRole("button", { name: "Cancel and release stock" }).click();
    await expect(page.locator(".badge", { hasText: "cancelled" })).toBeVisible();

    await page.goto(`/products?q=${UI_RES_PRODUCT}`);
    await expect(stockButton(page, UI_RES_PRODUCT, "PLG")).toHaveText("2");
    await setStockUI(page, UI_RES_PRODUCT, "PLG", original);
  });

  test("new orders appear on dashboard and orders list", async ({ page }) => {
    await expect(page.getByRole("link", { name: uiOrderCode })).toBeVisible();
    await page.goto("/orders?status=delivered");
    await expect(page.getByRole("link", { name: uiOrderCode })).toBeVisible();
  });

  test("docs page lists endpoints", async ({ page }) => {
    await page.goto("/docs");
    for (const p of [
      "/api/v1/warehouses",
      "/api/v1/products",
      "/api/v1/products/:id",
      "/api/v1/products/:id/transfer",
      "/api/v1/orders",
      "/api/v1/orders/:id",
      "/api/v1/orders/:id/confirm",
      "/api/v1/orders/:id/status",
    ]) {
      await expect(page.locator("code", { hasText: new RegExp(`^${p.replace(/[/:]/g, "\\$&")}$`) }).first()).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------- API keys UI

test.describe("API keys", () => {
  test("create key: shown once, listed by prefix", async ({ page }) => {
    await login(page);
    await page.goto("/api-keys");
    await expect(page.getByText("No API keys yet.")).toBeVisible();

    await page.getByLabel("New key name").fill("e2e key");
    await page.getByRole("button", { name: "Create key" }).click();
    const code = page.locator("code").first();
    await expect(code).toHaveText(/^wh_[A-Za-z0-9]{32}$/);
    apiKey = (await code.textContent())!;

    const row = page.locator("tbody tr", { hasText: "e2e key" });
    await expect(row).toContainText(apiKey.slice(0, 10));
    await expect(row).toContainText("active");
    await expect(row).toContainText("Never");

    await page.reload();
    await expect(page.getByText(apiKey)).toHaveCount(0); // full key never shown again
  });

  test("keys are private to their owner", async ({ page }) => {
    await login(page, "demo@warehouse.local", "demo1234");
    await page.goto("/api-keys");
    await expect(page.getByText("e2e key")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- public API

test.describe("public API", () => {
  test("auth: missing, invalid, Bearer", async ({ request }) => {
    let res = await request.get("/api/v1/products");
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");

    res = await api(request, "wh_invalid").get("/products");
    expect(res.status()).toBe(401);

    res = await request.get("/api/v1/products?limit=1", { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(res.status()).toBe(200);
  });

  test("GET /warehouses", async ({ request }) => {
    const res = await api(request).get("/warehouses");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.map((w: { code: string; name: string }) => [w.code, w.name])).toEqual([
      ["KDY", "Kandy"],
      ["PLG", "Peliyagoda"],
    ]);
    for (const w of data) {
      expect(w.units_available).toBeGreaterThan(0);
      expect(w.orders.delivered).toBeGreaterThan(40_000);
    }
  });

  test("GET /products: list, stock per warehouse, filters, sort, paging", async ({ request }) => {
    let body = await (await api(request).get("/products")).json();
    expect(body.total).toBe(280);
    expect(body.limit).toBe(20);
    expect(body.data).toHaveLength(20);
    expect(Object.keys(body.data[0]).sort()).toEqual(
      [
        "basis",
        "brand",
        "product_id",
        "stock",
        "total_available",
        "total_reserved",
        "unit_volume_m3",
        "unit_weight_kg",
        "updated_at",
        "verified_real_sku",
      ].sort(),
    );
    const p = body.data[0];
    expect(Object.keys(p.stock).sort()).toEqual(["KDY", "PLG"]);
    expect(p.total_available).toBe(p.stock.KDY.available + p.stock.PLG.available);

    body = await (await api(request).get("/products?brand=Tech&limit=500")).json();
    expect(body.total).toBe(178);
    expect(body.limit).toBe(100); // capped
    expect(body.data.every((x: { brand: string }) => x.brand === "Tech")).toBe(true);

    body = await (await api(request).get("/products?q=fresh_04&page=1&limit=3")).json();
    expect(body.total).toBe(7); // C32_FRESH_040..046
    expect(body.data).toHaveLength(3);
    const page3 = await (await api(request).get("/products?q=fresh_04&page=3&limit=3")).json();
    expect(page3.data).toHaveLength(1);

    body = await (await api(request).get("/products?warehouse=kandy&sort=stock&limit=50")).json(); // name accepted
    const kdy = body.data.map((x: { stock: { KDY: { available: number } } }) => x.stock.KDY.available);
    expect(kdy).toEqual([...kdy].sort((a: number, b: number) => a - b));

    const bad = await api(request).get("/products?warehouse=colombo");
    expect(bad.status()).toBe(422);
  });

  test("GET /products?low_stock=true", async ({ request }) => {
    const original = await availableOf(request, API_PRODUCT, "PLG");
    await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "PLG", stock: 3 });
    const body = await (await api(request).get("/products?warehouse=PLG&low_stock=true&limit=100")).json();
    expect(body.data.some((x: { product_id: string }) => x.product_id === API_PRODUCT)).toBe(true);
    expect(body.data.every((x: { stock: { PLG: { available: number } } }) => x.stock.PLG.available < 50)).toBe(true);
    const kdy = await (await api(request).get("/products?warehouse=KDY&low_stock=true&limit=100")).json();
    expect(kdy.data.some((x: { product_id: string }) => x.product_id === API_PRODUCT)).toBe(false);
    await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "PLG", stock: original });
  });

  test("GET /products/:id", async ({ request }) => {
    const res = await api(request).get("/products/C32_TECH_001");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ product_id: "C32_TECH_001", brand: "Tech", unit_weight_kg: 57.8, unit_volume_m3: 0.18 });
    expect(data.stock.KDY).toHaveProperty("available");
    expect(data.stock.PLG).toHaveProperty("reserved");

    const missing = await api(request).get("/products/NOPE");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("product_not_found");
  });

  test("PATCH /products/:id: per-warehouse set, adjust, validation", async ({ request }) => {
    const kdy = await availableOf(request, API_PRODUCT, "KDY");
    const plg = await availableOf(request, API_PRODUCT, "PLG");

    let res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "KDY", stock: 500 });
    expect(res.status()).toBe(200);
    let data = (await res.json()).data;
    expect(data.stock.KDY.available).toBe(500);
    expect(data.stock.PLG.available).toBe(plg); // untouched

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "KDY", adjust: -20 });
    expect((await res.json()).data.stock.KDY.available).toBe(480);

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "KDY", adjust: -10000 });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("insufficient_stock");

    for (const bad of [
      { stock: 5 }, // warehouse missing
      { warehouse: "XXX", stock: 5 },
      { warehouse: "KDY", stock: -1 },
      { warehouse: "KDY", stock: 1.5 },
      { warehouse: "KDY", foo: 1 },
      {},
    ]) {
      res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, bad);
      expect(res.status(), JSON.stringify(bad)).toBe(422);
    }

    res = await request.fetch(`/api/v1/products/${API_PRODUCT}`, {
      method: "PATCH",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      data: Buffer.from("{not json"), // Buffer: Playwright JSON-encodes string bodies
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");

    res = await api(request).send("PATCH", "/products/NOPE", { warehouse: "KDY", stock: 1 });
    expect(res.status()).toBe(404);

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { warehouse: "KDY", stock: kdy });
    data = (await res.json()).data;
    expect(data.stock.KDY.available).toBe(kdy);
  });

  test("POST /products/:id/transfer", async ({ request }) => {
    const kdy = await availableOf(request, API_PRODUCT, "KDY");
    const plg = await availableOf(request, API_PRODUCT, "PLG");

    let res = await api(request).send("POST", `/products/${API_PRODUCT}/transfer`, { from: "KDY", to: "peliyagoda", quantity: 25 });
    expect(res.status()).toBe(200);
    let data = (await res.json()).data;
    expect(data.stock.KDY.available).toBe(kdy - 25);
    expect(data.stock.PLG.available).toBe(plg + 25);

    res = await api(request).send("POST", `/products/${API_PRODUCT}/transfer`, { from: "KDY", to: "PLG", quantity: kdy + 1 });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("insufficient_stock");

    for (const bad of [
      { from: "KDY", to: "KDY", quantity: 1 },
      { from: "KDY", to: "XXX", quantity: 1 },
      { from: "KDY", to: "PLG", quantity: 0 },
      { from: "KDY", to: "PLG" },
    ]) {
      res = await api(request).send("POST", `/products/${API_PRODUCT}/transfer`, bad);
      expect(res.status(), JSON.stringify(bad)).toBe(422);
    }
    res = await api(request).send("POST", "/products/NOPE/transfer", { from: "KDY", to: "PLG", quantity: 1 });
    expect(res.status()).toBe(404);

    res = await api(request).send("POST", `/products/${API_PRODUCT}/transfer`, { from: "PLG", to: "KDY", quantity: 25 });
    data = (await res.json()).data;
    expect(data.stock.KDY.available).toBe(kdy);
    expect(data.stock.PLG.available).toBe(plg);
  });

  test("GET /orders and /orders/:id", async ({ request }) => {
    let body = await (await api(request).get("/orders?limit=5")).json();
    const allTotal = body.total;
    expect(body.data).toHaveLength(5);
    expect(allTotal).toBeGreaterThanOrEqual(97321);
    expect(body.data[0]).toHaveProperty("item_count");

    body = await (await api(request).get("/orders?status=delivered&limit=3")).json();
    expect(body.data.every((o: { status: string }) => o.status === "delivered")).toBe(true);

    const kdy = await (await api(request).get("/orders?warehouse=KDY&limit=50")).json();
    const plg = await (await api(request).get("/orders?warehouse=PLG&limit=50")).json();
    expect(kdy.data.every((o: { warehouse: { code: string } }) => o.warehouse.code === "KDY")).toBe(true);
    expect(plg.data.every((o: { warehouse: { code: string } }) => o.warehouse.code === "PLG")).toBe(true);
    expect(kdy.total + plg.total).toBe(allTotal);
    expect(kdy.total).toBeGreaterThan(40_000);
    expect(plg.total).toBeGreaterThan(40_000);

    const res = await api(request).get("/orders/ord0000001"); // case-insensitive
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ order_id: "ORD0000001", status: "delivered", source: "seed", warehouse: { code: "KDY", name: "Kandy" } });
    expect(data.items).toEqual([
      { product_id: "C32_FRESH_019", quantity: 4, requested_quantity: 4 },
      { product_id: "C32_FRESH_043", quantity: 4, requested_quantity: 4 },
    ]);
    const two = await (await api(request).get("/orders/ORD0000002")).json();
    expect(two.data.warehouse.code).toBe("PLG");

    const missing = await api(request).get("/orders/ORD9999999");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("order_not_found");
  });

  test("POST /orders: full order in one warehouse, totals, merge, status flow", async ({ request }) => {
    const k1 = await availableOf(request, API_PRODUCT, "KDY");
    const p1 = await availableOf(request, API_PRODUCT, "PLG");
    const p2 = await availableOf(request, API_PRODUCT_2, "PLG");
    const prod1 = (await (await api(request).get(`/products/${API_PRODUCT}`)).json()).data;
    const prod2 = (await (await api(request).get(`/products/${API_PRODUCT_2}`)).json()).data;

    const res = await api(request).send("POST", "/orders", {
      warehouse: "PLG",
      items: [
        { product_id: API_PRODUCT, quantity: 2 },
        { product_id: API_PRODUCT_2, quantity: 5 },
        { product_id: API_PRODUCT, quantity: 1 },
      ],
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.order_id).toMatch(/^ORD\d{7}$/);
    expect(data).toMatchObject({ status: "pending", source: "api", warehouse: { code: "PLG", name: "Peliyagoda" }, expires_at: null });
    expect(data.items).toEqual([
      { product_id: API_PRODUCT, quantity: 3, requested_quantity: 3 },
      { product_id: API_PRODUCT_2, quantity: 5, requested_quantity: 5 },
    ]);
    expect(data.total_weight_kg).toBeCloseTo(prod1.unit_weight_kg * 3 + prod2.unit_weight_kg * 5, 2);
    expect(data.total_volume_m3).toBeCloseTo(prod1.unit_volume_m3 * 3 + prod2.unit_volume_m3 * 5, 3);

    expect(await availableOf(request, API_PRODUCT, "PLG")).toBe(p1 - 3);
    expect(await availableOf(request, API_PRODUCT_2, "PLG")).toBe(p2 - 5);
    expect(await availableOf(request, API_PRODUCT, "KDY")).toBe(k1); // other warehouse untouched

    let r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "shipped" });
    expect((await r.json()).data.status).toBe("shipped");
    r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "cancelled" });
    expect(r.status()).toBe(409);
    expect((await r.json()).error.code).toBe("invalid_transition");
    r = await api(request).send("PATCH", `/orders/${data.order_id}/status`, { status: "delivered" }); // PATCH alias
    expect((await r.json()).data.status).toBe("delivered");
    r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "pending" });
    expect(r.status()).toBe(409);
    r = await api(request).send("POST", `/orders/${data.order_id}/confirm`);
    expect(r.status()).toBe(409); // only reserved orders can be confirmed
  });

  test("POST /orders: validation, warehouse required, not found, nothing available", async ({ request }) => {
    let res = await api(request).send("POST", "/orders", { items: [{ product_id: API_PRODUCT, quantity: 1 }] });
    expect(res.status()).toBe(422);
    res = await api(request).send("POST", "/orders", { warehouse: "colombo", items: [{ product_id: API_PRODUCT, quantity: 1 }] });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.message).toMatch(/KDY \(Kandy\)/);

    res = await api(request).send("POST", "/orders", { warehouse: "KDY", items: [{ product_id: "NOPE", quantity: 1 }] });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("product_not_found");

    for (const bad of [
      { warehouse: "KDY" },
      { warehouse: "KDY", items: [] },
      { warehouse: "KDY", items: [{ product_id: API_PRODUCT, quantity: 0 }] },
      { warehouse: "KDY", items: [{ product_id: API_PRODUCT, quantity: -1 }] },
      { warehouse: "KDY", items: [{ product_id: API_PRODUCT, quantity: 1.5 }] },
      { warehouse: "KDY", items: [{ product_id: API_PRODUCT, quantity: "2" }] },
      { warehouse: "KDY", items: [{ quantity: 1 }] },
    ]) {
      res = await api(request).send("POST", "/orders", bad);
      expect(res.status(), JSON.stringify(bad)).toBe(422);
      expect((await res.json()).error.code).toBe("validation_error");
    }

    // nothing available in that warehouse -> 409 and nothing locked, even if the other warehouse has plenty
    const original = await availableOf(request, API_PRODUCT_2, "KDY");
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "KDY", stock: 0 });
    res = await api(request).send("POST", "/orders", { warehouse: "KDY", items: [{ product_id: API_PRODUCT_2, quantity: 1 }] });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("insufficient_stock");
    expect(await stockOf(request, API_PRODUCT_2, "KDY")).toEqual({ available: 0, reserved: 0 });
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "KDY", stock: original });
  });

  test("POST /orders: short stock is reserved (202), locked, then confirmed", async ({ request }) => {
    const origP2 = await availableOf(request, API_PRODUCT_2, "PLG");
    const p1 = await availableOf(request, API_PRODUCT, "PLG");
    const k2 = await availableOf(request, API_PRODUCT_2, "KDY");
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "PLG", stock: 4 });

    const res = await api(request).send("POST", "/orders", {
      warehouse: "PLG",
      items: [
        { product_id: API_PRODUCT, quantity: 2 },
        { product_id: API_PRODUCT_2, quantity: 10 },
      ],
    });
    expect(res.status()).toBe(202);
    const body = await res.json();
    const code = body.data.order_id;
    expect(body.data.status).toBe("reserved");
    expect(new Date(body.data.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(body.data.items).toEqual([
      { product_id: API_PRODUCT, quantity: 2, requested_quantity: 2 },
      { product_id: API_PRODUCT_2, quantity: 4, requested_quantity: 10 },
    ]);
    expect(body.shortfall).toEqual([
      {
        product_id: API_PRODUCT_2,
        requested: 10,
        reserved: 4,
        shortfall: 6,
        other_warehouse: { code: "KDY", name: "Kandy", available: k2 },
      },
    ]);
    expect(body.message).toMatch(/confirm/);

    // locked: moved from available to reserved, nobody else can take it
    expect(await stockOf(request, API_PRODUCT_2, "PLG")).toEqual({ available: 0, reserved: 4 });
    expect(await stockOf(request, API_PRODUCT, "PLG")).toEqual({ available: p1 - 2, reserved: 2 });
    const other = await api(request).send("POST", "/orders", { warehouse: "PLG", items: [{ product_id: API_PRODUCT_2, quantity: 1 }] });
    expect(other.status()).toBe(409);

    const detail = await (await api(request).get(`/orders/${code}`)).json();
    expect(detail.shortfall).toHaveLength(1);
    const reservedList = await (await api(request).get("/orders?status=reserved&warehouse=PLG&limit=100")).json();
    expect(reservedList.data.some((o: { order_id: string }) => o.order_id === code)).toBe(true);

    const conf = await api(request).send("POST", `/orders/${code}/confirm`);
    expect(conf.status()).toBe(200);
    const confirmed = (await conf.json()).data;
    expect(confirmed.status).toBe("pending");
    expect(confirmed.expires_at).toBeNull();
    expect(await stockOf(request, API_PRODUCT_2, "PLG")).toEqual({ available: 0, reserved: 0 });
    expect(await stockOf(request, API_PRODUCT, "PLG")).toEqual({ available: p1 - 2, reserved: 0 });

    const again = await api(request).send("POST", `/orders/${code}/confirm`);
    expect(again.status()).toBe(409);

    // cancel the confirmed order -> units back to Peliyagoda; restore stock
    await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect(await stockOf(request, API_PRODUCT_2, "PLG")).toEqual({ available: 4, reserved: 0 });
    expect(await availableOf(request, API_PRODUCT, "PLG")).toBe(p1);
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "PLG", stock: origP2 });
  });

  test("reserved order: cancel releases lock; PUT status pending confirms", async ({ request }) => {
    const orig = await availableOf(request, API_PRODUCT_2, "KDY");
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "KDY", stock: 3 });

    let res = await api(request).send("POST", "/orders", { warehouse: "KDY", items: [{ product_id: API_PRODUCT_2, quantity: 5 }] });
    expect(res.status()).toBe(202);
    let code = (await res.json()).data.order_id;
    expect(await stockOf(request, API_PRODUCT_2, "KDY")).toEqual({ available: 0, reserved: 3 });

    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "shipped" });
    expect(res.status()).toBe(409); // must be confirmed first
    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect((await res.json()).data.status).toBe("cancelled");
    expect(await stockOf(request, API_PRODUCT_2, "KDY")).toEqual({ available: 3, reserved: 0 });
    res = await api(request).send("POST", `/orders/${code}/confirm`);
    expect(res.status()).toBe(409);

    res = await api(request).send("POST", "/orders", { warehouse: "KDY", items: [{ product_id: API_PRODUCT_2, quantity: 4 }] });
    code = (await res.json()).data.order_id;
    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "pending" }); // same as confirm
    expect((await res.json()).data.status).toBe("pending");
    expect(await stockOf(request, API_PRODUCT_2, "KDY")).toEqual({ available: 0, reserved: 0 });
    await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });

    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "KDY", stock: orig });
  });

  test("reserved order expires: lock released, confirm refused", async ({ request }) => {
    test.skip(!canUseDb, "needs DB access to fast-forward expiry (set TURSO_* env for remote runs)");
    const { dbClient } = await import("../scripts/libsql");
    const orig = await availableOf(request, API_PRODUCT_2, "PLG");
    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "PLG", stock: 2 });

    const res = await api(request).send("POST", "/orders", { warehouse: "PLG", items: [{ product_id: API_PRODUCT_2, quantity: 5 }] });
    expect(res.status()).toBe(202);
    const code = (await res.json()).data.order_id;
    expect(await stockOf(request, API_PRODUCT_2, "PLG")).toEqual({ available: 0, reserved: 2 });

    await dbClient().execute({
      sql: `UPDATE "Order" SET expiresAt = ? WHERE code = ?`,
      args: [new Date(Date.now() - 60_000).toISOString(), code],
    });

    const detail = await (await api(request).get(`/orders/${code}`)).json();
    expect(detail.data.status).toBe("expired");
    expect(await stockOf(request, API_PRODUCT_2, "PLG")).toEqual({ available: 2, reserved: 0 });
    const conf = await api(request).send("POST", `/orders/${code}/confirm`);
    expect(conf.status()).toBe(409);
    expect((await conf.json()).error.code).toBe("reservation_expired");

    await api(request).send("PATCH", `/products/${API_PRODUCT_2}`, { warehouse: "PLG", stock: orig });
  });

  test("PUT /orders/:id/status: cancel restores stock to order's warehouse", async ({ request }) => {
    const before = await availableOf(request, API_PRODUCT, "KDY");
    const created = await (await api(request).send("POST", "/orders", { warehouse: "KDY", items: [{ product_id: API_PRODUCT, quantity: 6 }] })).json();
    const code = created.data.order_id;
    expect(await availableOf(request, API_PRODUCT, "KDY")).toBe(before - 6);

    let res = await api(request).send("PUT", `/orders/${code}/status`, { status: "bogus" });
    expect(res.status()).toBe(422);

    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.status).toBe("cancelled");
    expect(await availableOf(request, API_PRODUCT, "KDY")).toBe(before);

    // cancelling again is a no-op, must not double-restore
    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect(res.status()).toBe(200);
    expect(await availableOf(request, API_PRODUCT, "KDY")).toBe(before);

    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "shipped" });
    expect(res.status()).toBe(409);

    res = await api(request).send("PUT", "/orders/ORD9999999/status", { status: "shipped" });
    expect(res.status()).toBe(404);
  });

  test("API key usage is recorded; revoke blocks; delete removes", async ({ page, request }) => {
    await login(page);
    await page.goto("/api-keys");
    const row = page.locator("tbody tr", { hasText: "e2e key" });
    await expect(row).not.toContainText("Never"); // lastUsedAt set

    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("revoked");
    const res = await api(request).get("/products?limit=1");
    expect(res.status()).toBe(401);

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No API keys yet.")).toBeVisible();
  });
});
