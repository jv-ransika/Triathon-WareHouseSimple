# Warehouse Simple

A small warehouse app for two warehouses, **Kandy (`KDY`)** and **Peliyagoda (`PLG`)**. It has a web dashboard, one-role email/password accounts, and a REST API authenticated by API keys that each user manages.

**Live:** https://triathon-warehouse-simple.vercel.app (demo login `demo@warehouse.local` / `demo1234`)

- **Stack:** Next.js 15 (App Router), Prisma 6, libSQL, Tailwind CSS 4
- **Database:** SQLite file (`dev.db`) locally, [Turso](https://turso.tech) (hosted libSQL) in production
- **Hosting:** Vercel. Every push to `main` deploys to production.

## Features

- **Auth:** register, log in and log out. Passwords are hashed with bcrypt; sessions are JWTs in an httpOnly cookie that lasts 7 days.
- **Warehouse switcher:** the sidebar picks Kandy, Peliyagoda or All warehouses. The dashboard, orders list, product sorting and the default warehouse for new orders follow it.
- **Dashboard:** units available and locked, orders, orders awaiting confirmation, orders per month, units ordered by brand, top products, recent orders and low-stock rows (under 50 units). With All selected it also shows a tile per warehouse.
- **Temperature:** every product is `ambient` or `chilled`. Products and orders show it and can be filtered by it, and the dashboard breaks orders and stock down by it.
- **Products:** stock per warehouse, with each warehouse's number editable inline. Transfer units between warehouses. Search, filter by brand, sort by stock, show low stock only.
- **Orders:** every order belongs to one warehouse and takes stock from that warehouse only. List with status filter and search, order detail with status changes, and a form to place new orders.
- **Stock locking:** if the chosen warehouse can't cover an order, the units it does have are locked for that order until you confirm the partial order or cancel. See [Stock locking](#stock-locking).
- **API keys:** create, revoke and delete your own keys. A key is shown once and only its SHA-256 hash is stored.
- **API docs:** `/docs` in the app has curl examples for every endpoint.

All users share the same products and orders. API keys belong to the user who created them.

## Data

The database is seeded from the two CSV files in the repo root. [`DATASET.md`](DATASET.md) explains how they were built.

| File | Rows | Becomes |
|---|---|---|
| `products.csv` | 330 products | `Product` table |
| `order_products.csv` | 194,366 order lines | 97,321 orders in `Order` + `OrderItem` |

`products.csv` columns: `product_id, brand, temp_requirement, unit_weight_kg, unit_volume_m3, base_product_id, basis, temperature_basis, verified_real_sku`.

| Brand | Ambient | Chilled |
|---|---:|---:|
| Fresh | 53 | 52 |
| Style | 47 | 0 |
| Tech | 178 | 0 |

- Product IDs end in `_AMB` or `_CHL`. Fifty Fresh products exist in both versions, for example `C32_FRESH_019_AMB` and `C32_FRESH_019_CHL`. Both share a `base_product_id` and have the same weight and volume.
- Every order in the data has a single temperature: 60,290 are ambient and 37,031 chilled. Each order stores its `temp_requirement`, taken from its products. An order placed with both kinds is saved as `mixed`. It isn't refused, but the order form warns about it.
- The products are inferred candidates, not real verified SKUs (`verified_real_sku` is false for all of them).

The CSVs have no warehouses, stock levels or order dates, so the seed fills these in:

- Two warehouses: `KDY` Kandy and `PLG` Peliyagoda.
- Every product starts with 1000 units in **each** warehouse (`Stock` table, 660 rows).
- Seeded orders alternate by order number: odd numbers are Kandy (48,665 orders), even numbers are Peliyagoda (48,656).
- Seeded orders are marked `delivered`, have source `seed`, and don't reduce stock.
- Seeded order dates are spread evenly over the year before the seed ran, so the monthly chart has data.
- Order numbers in the CSV go up to `ORD0097345` with gaps; new orders continue from there.

In the order tables, **Lines** means the number of different products in an order, not the number of units.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env     # then set JWT_SECRET to a long random string
npm run db:setup         # creates tables and loads the CSVs (about 20 s)
npm run dev              # http://localhost:3000
```

To generate a `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The seed creates the demo user `demo@warehouse.local` / `demo1234` if it doesn't exist.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | `prisma generate` + production build |
| `npm run db:apply` | Create tables from `prisma/init.sql`. Safe to re-run. |
| `npm run db:seed` | **Deletes all warehouses, products, stock and orders** and reloads them from the CSVs. Users and API keys are kept. |
| `npm run db:setup` | `db:apply` then `db:seed` |
| `npm run db:reset` | **Drops** the warehouse, product, stock and order tables, recreates them from `prisma/init.sql`, then seeds. Use after a schema change. Users and API keys are kept. |
| `npm run db:sql` | Regenerate `prisma/init.sql` after editing `prisma/schema.prisma` |

## Environment variables

| Variable | Needed | Description |
|---|---|---|
| `JWT_SECRET` | Always | Signs session cookies. Use a long random string. |
| `DATABASE_URL` | Local / manual setup | `file:./dev.db` locally, or a `libsql://…` URL |
| `DATABASE_AUTH_TOKEN` | Manual Turso setup | Turso auth token |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Set automatically by the Vercel Turso integration | Used instead of `DATABASE_*` when present |
| `RESERVATION_MINUTES` | Optional | How long stock stays locked for an order awaiting confirmation. Default 15. |

## Deployment (Vercel + Turso)

The live site is already set up this way:

- Vercel project `triathon-warehouse-simple`, connected to this GitHub repo
- Turso database `warehouse-db`, added through the Vercel marketplace, which set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the project
- `JWT_SECRET` set for production, preview and development

To redeploy, push to `main`.

Vercel functions can't keep a local SQLite file between requests, which is why production uses Turso.

### Set up a new deployment

Requires the Vercel CLI (`npm i -g vercel`), logged in with `vercel login`.

```bash
vercel link                                   # create/link the Vercel project
vercel integration add tursocloud/database    # create a Turso DB and set TURSO_* on the project

# Load the CSVs into the Turso DB from your machine.
# Keep the pulled file inside .vercel/ (gitignored). A .env.production.local in the project root
# would be loaded by `next build`/`next start`, and local runs would then use the production DB.
vercel env pull .vercel/.env.production.local --environment production
npx dotenv -e .vercel/.env.production.local -- npm run db:setup

# Session secret (repeat with "preview" if you use preview deployments)
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | vercel env add JWT_SECRET production

vercel --prod                                 # or connect the GitHub repo and push
```

Loading the data into Turso takes about 2 minutes. The scripts retry if the connection drops.

**Without the marketplace integration:** create a database with the Turso CLI (`turso db create`, `turso db show --url`, `turso db tokens create`). Then run `DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run db:setup`, and set `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `JWT_SECRET` in the Vercel project settings.

> **Warning:** running `db:seed`, `db:setup` or `db:reset` against production deletes every order, including real ones, and resets all stock to 1000 per warehouse.

**Changing the schema on production:** `db:apply` only creates missing tables; it doesn't alter existing ones. After changing `prisma/schema.prisma`, run `npm run db:sql`. Then run `npx dotenv -e .vercel/.env.production.local -- npm run db:reset` **before** pushing, so the database matches the new code.

## Stock locking

When you place an order, the chosen warehouse is checked line by line:

| Situation | Result |
|---|---|
| Every line is available | Stock is taken. Order status `pending`. API returns **201**. |
| Some lines are short | The units that *are* available are **locked** for this order: they move from `available` to `reserved` so no one else can take them. Order status `reserved` (shown as "awaiting confirmation"), with an `expires_at` 15 minutes ahead. API returns **202** with a `shortfall` list that includes what the other warehouse has. |
| Nothing is available | Nothing is locked. API returns **409** `insufficient_stock`. |

A `reserved` order then ends in one of three ways:

- **Confirm** (UI button, `POST /orders/:id/confirm`, or status `pending`): the order becomes `pending` with the locked quantities. `quantity` shows what it got and `requested_quantity` what was asked for.
- **Cancel** (status `cancelled`): the locked units go back to available.
- **Expire:** after `expires_at` the order becomes `expired` and the units go back. There's no cron job. Expiry is applied the next time anyone reads or changes stock or orders.

To fill the rest, transfer units from the other warehouse on the Products page (or `POST /products/:id/transfer`) and place another order.

## API

Base URL: `https://triathon-warehouse-simple.vercel.app/api/v1`

Create a key on the **API keys** page, then send it as `x-api-key: <key>` or `Authorization: Bearer <key>`.

Wherever a warehouse is expected you can pass the code (`KDY`, `PLG`) or the name (`kandy`, `peliyagoda`), case-insensitive.

| Method | Path | Description |
|---|---|---|
| GET | `/warehouses` | Both warehouses with units available, units locked, stock by temperature and order counts by status |
| GET | `/products?warehouse=&brand=&temp=&q=&sort=stock&low_stock=true&page=&limit=` | List products with temperature and stock per warehouse. `temp` is `ambient` or `chilled`. `warehouse` picks which warehouse `sort` and `low_stock` look at; without it they use the total and the lowest warehouse. `limit` is at most 100. |
| GET | `/products/:id` | One product |
| PATCH | `/products/:id` | `{ "warehouse": "KDY", "stock": n }` sets or `{ "warehouse": "KDY", "adjust": ±n }` changes available stock in one warehouse |
| POST | `/products/:id/transfer` | `{ "from": "KDY", "to": "PLG", "quantity": n }` moves available units between warehouses |
| GET | `/orders?warehouse=&temp=&status=&page=&limit=` | List orders, newest first. Each order has `temp_requirement`: `ambient`, `chilled` or `mixed`. |
| GET | `/orders/:id` | One order with its items (`:id` is the order code, e.g. `ORD0000001`). Reserved orders include `shortfall`. |
| POST | `/orders` | `{ "warehouse": "KDY", "items": [{ "product_id": "C32_TECH_001", "quantity": 2 }] }`. Returns 201, 202 or 409 (see [Stock locking](#stock-locking)). |
| POST | `/orders/:id/confirm` | Accept a reserved order |
| PUT | `/orders/:id/status` | Change status: `{ "status": "shipped" }` |

A product looks like:

```json
{ "product_id": "C32_FRESH_019_CHL", "brand": "Fresh", "temp_requirement": "chilled",
  "unit_weight_kg": 6.618, "unit_volume_m3": 0.0336, "base_product_id": "C32_FRESH_019",
  "basis": "cluster_center", "temperature_basis": "inherited_from_original_order", "verified_real_sku": false,
  "stock": { "KDY": { "available": 995, "reserved": 5 }, "PLG": { "available": 1000, "reserved": 0 } },
  "total_available": 1995, "total_reserved": 5, "updated_at": "…" }
```

Allowed status changes:

- `reserved` to `pending` (confirm) or `cancelled`. It becomes `expired` automatically.
- `pending` to `shipped` or `cancelled`
- `shipped` to `delivered`

Cancelling returns the units to the order's own warehouse.

### Example

```bash
export WH_KEY=wh_xxxxxxxx
curl -H "x-api-key: $WH_KEY" "https://triathon-warehouse-simple.vercel.app/api/v1/products?temp=chilled&warehouse=KDY&sort=stock&limit=5"

curl -X POST -H "x-api-key: $WH_KEY" -H "Content-Type: application/json" \
  -d '{"warehouse":"PLG","items":[{"product_id":"C32_TECH_001_AMB","quantity":2}]}' \
  https://triathon-warehouse-simple.vercel.app/api/v1/orders

# if that returned 202 (partially available):
curl -X POST -H "x-api-key: $WH_KEY" https://triathon-warehouse-simple.vercel.app/api/v1/orders/ORD0097350/confirm
```

### Errors

Errors look like `{ "error": { "code": "...", "message": "..." } }`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_json` | Body isn't valid JSON |
| 401 | `unauthorized` | Key is missing, invalid or revoked |
| 404 | `product_not_found`, `order_not_found` | Unknown product or order |
| 409 | `insufficient_stock` | Nothing available in that warehouse, stock would go below 0, or a transfer source is short |
| 409 | `invalid_transition` | Status change that isn't allowed, or confirming an order that isn't reserved |
| 409 | `reservation_expired` | Confirming after the lock ran out |
| 409 | `stock_changed` | Another order took the same units at the same moment; retry |
| 422 | `validation_error` | Body has the wrong shape, a missing or unknown warehouse, or an unknown `temp` |

## Testing

`tests/e2e.spec.ts` is a Playwright suite (41 tests) that drives the UI in Chrome and calls every API endpoint. It covers:

- **Auth:** register, validation, login, logout and redirects
- **Warehouses:** the switcher scoping the dashboard and orders, per-warehouse stock editing, and transfers
- **Temperature:** product and order filters, temperature fields in the API, mixed-temperature orders, and the warning on the order form
- **UI:** dashboard, product search, filters, sorting and paging, and the order form
- **Orders:** an order takes stock only from its own warehouse, status changes, and cancel returning stock to the right warehouse
- **Stock locking:** partial orders lock stock, locked units can't be taken by others, and confirm, cancel and expiry all work
- **API keys:** creating, revoking and deleting keys
- **API:** every endpoint and error case

It uses the Chrome installed on your machine; no browser download is needed.

```bash
npm run build
npm run test:e2e        # starts `next start` on port 3100 against the local dev.db
npm run test:cleanup    # removes e2e-*@test.local users, their keys and orders, and returns their stock
```

The expiry test moves a reservation's deadline into the past directly in the database. Locally it uses `.env`. Against a deployed site it needs that site's database settings, and it is skipped without them:

```bash
vercel env pull .vercel/.env.production.local --environment production
BASE_URL=https://triathon-warehouse-simple.vercel.app npx dotenv -e .vercel/.env.production.local -- npm run test:e2e
npx dotenv -e .vercel/.env.production.local -- npm run test:cleanup
```

> **Warning:** running the suite against a deployed site writes to its database. It temporarily changes the stock of `C32_STYLE_010_AMB`, `C32_STYLE_011_AMB`, `C32_TECH_050_AMB` and `C32_FRESH_020_CHL` and adds test orders. Run `test:cleanup` afterwards.

## Project layout

```
prisma/schema.prisma         data model
prisma/init.sql              generated schema SQL (applied by scripts/db-apply.ts)
prisma/seed.ts               CSV import
scripts/                     DB apply script and shared libSQL client
src/lib/orders.ts            orders, stock locking, confirm/expiry, stock edits and transfers (used by the UI and the API)
src/lib/warehouses.ts        warehouse codes and names
src/lib/warehouseScope.ts    reads the sidebar warehouse switcher cookie
src/lib/apiKey.ts            key generation and authentication
src/lib/auth.ts, session.ts  passwords and session cookie
src/app/api/v1/              public REST API
src/app/(auth)/              login and register
src/app/(app)/               dashboard, products, orders, API keys, docs
src/middleware.ts            redirects signed-out users to /login
```
