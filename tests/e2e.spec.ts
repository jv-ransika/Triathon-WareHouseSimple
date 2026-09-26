import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// End-to-end suite: UI flows (auth, dashboard, products, orders, API keys) and the public API.
// Test users are e2e-<timestamp>@test.local; remove their data with `npm run test:cleanup`.
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const user = { name: "E2E Tester", email: `e2e-${stamp}@test.local`, password: "e2e-password-123" };
let apiKey = "";
let uiOrderCode = "";

const UI_PRODUCT = "C32_STYLE_010";
const API_PRODUCT = "C32_TECH_050";
const API_PRODUCT_2 = "C32_FRESH_020";

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
  send: (method: "POST" | "PUT" | "PATCH", path: string, data: unknown) =>
    request.fetch(`/api/v1${path}`, { method, headers: { "x-api-key": key }, data }),
});

async function stockOf(request: APIRequestContext, id: string): Promise<number> {
  const res = await api(request).get(`/products/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data.stock;
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
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("demo user can log in", async ({ page }) => {
    await login(page, "demo@warehouse.local", "demo1234");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

// ---------------------------------------------------------------- UI pages

test.describe("dashboard, products, orders UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("dashboard shows stats and charts", async ({ page }) => {
    for (const label of ["Products", "Orders", "Units ordered", "Low stock"]) {
      await expect(page.locator(".card .muted.text-xs", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Orders per month" })).toBeVisible();
    expect(await page.locator(".chart-col").count()).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Units ordered by brand" })).toBeVisible();
    for (const brand of ["Fresh", "Style", "Tech"]) await expect(page.locator(".card").getByText(brand, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent orders" })).toBeVisible();
    expect(await page.locator("table").first().locator("tbody tr").count()).toBeGreaterThan(0);
  });

  test("products: search, brand filter, sort, paging", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByText("280 results")).toBeVisible();

    await page.getByPlaceholder("Search product ID").fill("tech_00");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("9 results")).toBeVisible(); // C32_TECH_001..009
    await expect(page.locator("tbody tr")).toHaveCount(9);

    await page.goto("/products?brand=Style");
    await expect(page.getByText("47 results")).toBeVisible();
    await expect(page.locator("tbody td:nth-child(2)").first()).toHaveText("Style");

    await page.goto("/products?sort=stock");
    const stocks = await page.locator("tbody td:last-child button").allTextContents();
    const nums = stocks.map((s) => Number(s.replace(/\D/g, "")));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));

    await page.goto("/products");
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("page 2 of 12")).toBeVisible();
  });

  test("products: inline stock edit", async ({ page, request }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const row = page.locator("tbody tr", { hasText: UI_PRODUCT });
    const before = Number((await row.locator("td:last-child button").textContent())!.replace(/\D/g, ""));

    await row.getByTitle("Click to edit stock").click();
    await row.locator('input[name="stock"]').fill(String(before + 7));
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByTitle("Click to edit stock")).toHaveText((before + 7).toLocaleString("en-US"));

    // restore
    await row.getByTitle("Click to edit stock").click();
    await row.locator('input[name="stock"]').fill(String(before));
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByTitle("Click to edit stock")).toHaveText(before.toLocaleString("en-US"));
    void request;
  });

  test("orders: filter, search, detail", async ({ page }) => {
    await page.goto("/orders?status=delivered");
    await expect(page.locator("tbody tr").first()).toContainText("delivered");

    await page.goto("/orders");
    await page.getByPlaceholder("Search order ID").fill("ORD0000001");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: "ORD0000001", exact: true }).click();
    await expect(page).toHaveURL(/\/orders\/ORD0000001$/);
    await expect(page.getByRole("heading", { name: "ORD0000001" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "C32_FRESH_019" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "C32_FRESH_043" })).toBeVisible();
    await expect(page.getByText("No further status changes.")).toBeVisible(); // delivered

    await page.goto("/orders/NOPE123");
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });

  test("orders: new order form validates", async ({ page }) => {
    await page.goto("/orders/new");
    await page.getByPlaceholder("e.g. C32_TECH_001").fill("NOT_A_PRODUCT");
    await expect(page.getByText("Unknown product")).toBeVisible();
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Unknown product(s): NOT_A_PRODUCT")).toBeVisible();

    await page.getByPlaceholder("e.g. C32_TECH_001").fill(UI_PRODUCT);
    await page.locator('input[type="number"]').fill("999999");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText(/Insufficient stock for C32_STYLE_010/)).toBeVisible();
  });

  test("orders: place order, ship, deliver; stock decremented", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const stockBtn = page.locator("tbody tr", { hasText: UI_PRODUCT }).getByTitle("Click to edit stock");
    const before = Number((await stockBtn.textContent())!.replace(/\D/g, ""));

    await page.goto("/orders/new");
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
    await expect(page.getByText(`ui · ${user.email}`)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr td").nth(2)).toHaveText("5");

    await page.getByRole("button", { name: "Mark shipped" }).click();
    await expect(page.locator(".badge", { hasText: "shipped" })).toBeVisible();
    await page.getByRole("button", { name: "Mark delivered" }).click();
    await expect(page.locator(".badge", { hasText: "delivered" })).toBeVisible();
    await expect(page.getByText("No further status changes.")).toBeVisible();

    await page.goto(`/products?q=${UI_PRODUCT}`);
    await expect(stockBtn).toHaveText((before - 5).toLocaleString("en-US"));
  });

  test("orders: cancel restores stock", async ({ page }) => {
    await page.goto(`/products?q=${UI_PRODUCT}`);
    const stockBtn = page.locator("tbody tr", { hasText: UI_PRODUCT }).getByTitle("Click to edit stock");
    const before = Number((await stockBtn.textContent())!.replace(/\D/g, ""));

    await page.goto("/orders/new");
    await page.getByPlaceholder("e.g. C32_TECH_001").fill(UI_PRODUCT);
    await page.locator('input[type="number"]').fill("4");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/orders\/ORD\d{7}$/);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.locator(".badge", { hasText: "cancelled" })).toBeVisible();

    await page.goto(`/products?q=${UI_PRODUCT}`);
    await expect(stockBtn).toHaveText(before.toLocaleString("en-US"));
  });

  test("new orders appear on dashboard and orders list", async ({ page }) => {
    await expect(page.getByRole("link", { name: uiOrderCode })).toBeVisible();
    await page.goto("/orders?status=delivered");
    await expect(page.getByRole("link", { name: uiOrderCode })).toBeVisible();
  });

  test("docs page lists endpoints", async ({ page }) => {
    await page.goto("/docs");
    for (const p of ["/api/v1/products", "/api/v1/products/:id", "/api/v1/orders", "/api/v1/orders/:id", "/api/v1/orders/:id/status"]) {
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

  test("GET /products: list, filters, paging, limits", async ({ request }) => {
    let body = await (await api(request).get("/products")).json();
    expect(body.total).toBe(280);
    expect(body.limit).toBe(20);
    expect(body.data).toHaveLength(20);
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["basis", "brand", "product_id", "stock", "unit_volume_m3", "unit_weight_kg", "updated_at", "verified_real_sku"].sort(),
    );

    body = await (await api(request).get("/products?brand=Tech&limit=500")).json();
    expect(body.total).toBe(178);
    expect(body.limit).toBe(100); // capped
    expect(body.data.every((p: { brand: string }) => p.brand === "Tech")).toBe(true);

    body = await (await api(request).get("/products?q=fresh_04&page=1&limit=3")).json();
    expect(body.total).toBe(7); // C32_FRESH_040..046
    expect(body.data).toHaveLength(3);
    const page3 = await (await api(request).get("/products?q=fresh_04&page=3&limit=3")).json();
    expect(page3.data).toHaveLength(1);
  });

  test("GET /products/:id", async ({ request }) => {
    const res = await api(request).get("/products/C32_TECH_001");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ product_id: "C32_TECH_001", brand: "Tech", unit_weight_kg: 57.8, unit_volume_m3: 0.18 });

    const missing = await api(request).get("/products/NOPE");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("product_not_found");
  });

  test("PATCH /products/:id: set, adjust, validation", async ({ request }) => {
    const original = await stockOf(request, API_PRODUCT);

    let res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { stock: 500 });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.stock).toBe(500);

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { adjust: -20 });
    expect((await res.json()).data.stock).toBe(480);

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { adjust: -10000 });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("insufficient_stock");

    for (const bad of [{ stock: -1 }, { stock: 1.5 }, { foo: 1 }, {}]) {
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

    res = await api(request).send("PATCH", "/products/NOPE", { stock: 1 });
    expect(res.status()).toBe(404);

    res = await api(request).send("PATCH", `/products/${API_PRODUCT}`, { stock: original });
    expect((await res.json()).data.stock).toBe(original);
  });

  test("GET /orders and /orders/:id", async ({ request }) => {
    let body = await (await api(request).get("/orders?limit=5")).json();
    expect(body.data).toHaveLength(5);
    expect(body.total).toBeGreaterThanOrEqual(97321);
    expect(body.data[0]).toHaveProperty("item_count");

    body = await (await api(request).get("/orders?status=delivered&limit=3")).json();
    expect(body.data.every((o: { status: string }) => o.status === "delivered")).toBe(true);

    const res = await api(request).get("/orders/ord0000001"); // case-insensitive
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ order_id: "ORD0000001", status: "delivered", source: "seed" });
    expect(data.items).toEqual([
      { product_id: "C32_FRESH_019", quantity: 4 },
      { product_id: "C32_FRESH_043", quantity: 4 },
    ]);

    const missing = await api(request).get("/orders/ORD9999999");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("order_not_found");
  });

  test("POST /orders: create, totals, merge duplicates, stock", async ({ request }) => {
    const s1 = await stockOf(request, API_PRODUCT);
    const s2 = await stockOf(request, API_PRODUCT_2);
    const p1 = (await (await api(request).get(`/products/${API_PRODUCT}`)).json()).data;
    const p2 = (await (await api(request).get(`/products/${API_PRODUCT_2}`)).json()).data;

    const res = await api(request).send("POST", "/orders", {
      items: [
        { product_id: API_PRODUCT, quantity: 2 },
        { product_id: API_PRODUCT_2, quantity: 5 },
        { product_id: API_PRODUCT, quantity: 1 },
      ],
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.order_id).toMatch(/^ORD\d{7}$/);
    expect(data).toMatchObject({ status: "pending", source: "api" });
    expect(data.items).toEqual([
      { product_id: API_PRODUCT, quantity: 3 },
      { product_id: API_PRODUCT_2, quantity: 5 },
    ]);
    expect(data.total_weight_kg).toBeCloseTo(p1.unit_weight_kg * 3 + p2.unit_weight_kg * 5, 2);
    expect(data.total_volume_m3).toBeCloseTo(p1.unit_volume_m3 * 3 + p2.unit_volume_m3 * 5, 3);

    expect(await stockOf(request, API_PRODUCT)).toBe(s1 - 3);
    expect(await stockOf(request, API_PRODUCT_2)).toBe(s2 - 5);

    const fetched = await (await api(request).get(`/orders/${data.order_id}`)).json();
    expect(fetched.data.items).toHaveLength(2);

    // status flow: pending -> shipped -> delivered; no going back
    let r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "shipped" });
    expect((await r.json()).data.status).toBe("shipped");
    r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "cancelled" });
    expect(r.status()).toBe(409);
    expect((await r.json()).error.code).toBe("invalid_transition");
    r = await api(request).send("PATCH", `/orders/${data.order_id}/status`, { status: "delivered" }); // PATCH alias
    expect((await r.json()).data.status).toBe("delivered");
    r = await api(request).send("PUT", `/orders/${data.order_id}/status`, { status: "pending" });
    expect(r.status()).toBe(409);
  });

  test("POST /orders: atomic failure, validation, not found", async ({ request }) => {
    const s1 = await stockOf(request, API_PRODUCT);
    const s2 = await stockOf(request, API_PRODUCT_2);

    // second line fails -> first line must not be decremented
    let res = await api(request).send("POST", "/orders", {
      items: [
        { product_id: API_PRODUCT, quantity: 1 },
        { product_id: API_PRODUCT_2, quantity: 10_000_000 },
      ],
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("insufficient_stock");
    expect(await stockOf(request, API_PRODUCT)).toBe(s1);
    expect(await stockOf(request, API_PRODUCT_2)).toBe(s2);

    res = await api(request).send("POST", "/orders", { items: [{ product_id: "NOPE", quantity: 1 }] });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("product_not_found");

    for (const bad of [
      {},
      { items: [] },
      { items: [{ product_id: API_PRODUCT, quantity: 0 }] },
      { items: [{ product_id: API_PRODUCT, quantity: -1 }] },
      { items: [{ product_id: API_PRODUCT, quantity: 1.5 }] },
      { items: [{ product_id: API_PRODUCT, quantity: "2" }] },
      { items: [{ quantity: 1 }] },
    ]) {
      res = await api(request).send("POST", "/orders", bad);
      expect(res.status(), JSON.stringify(bad)).toBe(422);
      expect((await res.json()).error.code).toBe("validation_error");
    }
  });

  test("PUT /orders/:id/status: cancel restores stock, validation", async ({ request }) => {
    const before = await stockOf(request, API_PRODUCT);
    const created = await (await api(request).send("POST", "/orders", { items: [{ product_id: API_PRODUCT, quantity: 6 }] })).json();
    const code = created.data.order_id;
    expect(await stockOf(request, API_PRODUCT)).toBe(before - 6);

    let res = await api(request).send("PUT", `/orders/${code}/status`, { status: "bogus" });
    expect(res.status()).toBe(422);

    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.status).toBe("cancelled");
    expect(await stockOf(request, API_PRODUCT)).toBe(before);

    // cancelling again is a no-op, must not double-restore
    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "cancelled" });
    expect(res.status()).toBe(200);
    expect(await stockOf(request, API_PRODUCT)).toBe(before);

    res = await api(request).send("PUT", `/orders/${code}/status`, { status: "shipped" });
    expect(res.status()).toBe(409);

    res = await api(request).send("PUT", "/orders/ORD9999999/status", { status: "shipped" });
    expect(res.status()).toBe(404);

    const list = await (await api(request).get("/orders?status=cancelled&limit=100")).json();
    expect(list.data.some((o: { order_id: string }) => o.order_id === code)).toBe(true);
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
