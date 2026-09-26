# Warehouse Simple

A small warehouse app with a web dashboard, one-role email/password accounts, and a REST API authenticated by API keys that each user manages.

**Live:** https://triathon-warehouse-simple.vercel.app (demo login `demo@warehouse.local` / `demo1234`)

- **Stack:** Next.js 15 (App Router), Prisma 6, libSQL, Tailwind CSS 4
- **Database:** SQLite file (`dev.db`) locally, [Turso](https://turso.tech) (hosted libSQL) in production
- **Hosting:** Vercel. Every push to `main` deploys to production.

## Features

- **Auth:** register, log in and log out. Passwords are hashed with bcrypt; sessions are JWTs in an httpOnly cookie that lasts 7 days.
- **Dashboard:** totals, orders per month, units ordered by brand, top products, recent orders and low-stock products (under 50 units).
- **Products:** search, filter by brand, sort by stock, and edit stock inline.
- **Orders:** list with status filter and search; order detail with status changes; a form to place new orders.
- **API keys:** create, revoke and delete your own keys. A key is shown once and only its SHA-256 hash is stored.
- **API docs:** `/docs` in the app has curl examples for every endpoint.

All users share the same products and orders. API keys belong to the user who created them.

## Data

The database is seeded from the two CSV files in the repo root:

| File | Rows | Becomes |
|---|---|---|
| `products.csv` | 280 products | `Product` table (brands: Fresh, Style, Tech) |
| `order_products.csv` | 194,366 order lines | 97,321 orders in `Order` + `OrderItem` |

The CSVs have no stock levels or order dates, so the seed fills these in:

- Every product starts with 1000 units in stock.
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
| `npm run db:seed` | **Deletes all products and orders** and reloads them from the CSVs. Users and API keys are kept. |
| `npm run db:setup` | `db:apply` then `db:seed` |
| `npm run db:sql` | Regenerate `prisma/init.sql` after editing `prisma/schema.prisma` |

## Environment variables

| Variable | Needed | Description |
|---|---|---|
| `JWT_SECRET` | Always | Signs session cookies. Use a long random string. |
| `DATABASE_URL` | Local / manual setup | `file:./dev.db` locally, or a `libsql://…` URL |
| `DATABASE_AUTH_TOKEN` | Manual Turso setup | Turso auth token |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Set automatically by the Vercel Turso integration | Used instead of `DATABASE_*` when present |

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

# Load the CSVs into the Turso DB from your machine
vercel env pull .env.production.local --environment production
npx dotenv -e .env.production.local -- npm run db:setup

# Session secret (repeat with "preview" if you use preview deployments)
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | vercel env add JWT_SECRET production

vercel --prod                                 # or connect the GitHub repo and push
```

Loading the data into Turso takes about 2 minutes. The scripts retry if the connection drops.

**Without the marketplace integration:** create a database with the Turso CLI (`turso db create`, `turso db show --url`, `turso db tokens create`). Then run `DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run db:setup`, and set `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `JWT_SECRET` in the Vercel project settings.

> **Warning:** running `db:seed` (or `db:setup`) against production deletes every order, including real ones, and resets all stock to 1000.

## API

Base URL: `https://triathon-warehouse-simple.vercel.app/api/v1`

Create a key on the **API keys** page, then send it as `x-api-key: <key>` or `Authorization: Bearer <key>`.

| Method | Path | Description |
|---|---|---|
| GET | `/products?brand=&q=&page=&limit=` | List products. `brand` is Fresh, Style or Tech; `q` searches the product ID; `limit` is at most 100. |
| GET | `/products/:id` | One product |
| PATCH | `/products/:id` | Set stock with `{ "stock": n }` or change it with `{ "adjust": ±n }` |
| GET | `/orders?status=&page=&limit=` | List orders, newest first |
| GET | `/orders/:id` | One order with its items. `:id` is the order code, e.g. `ORD0000001`. |
| POST | `/orders` | Place an order: `{ "items": [{ "product_id": "C32_TECH_001", "quantity": 2 }] }` |
| PUT | `/orders/:id/status` | Change status: `{ "status": "shipped" }` |

Placing an order reduces stock. If any line doesn't have enough stock, the whole order is rejected.

Allowed status changes:

- `pending` to `shipped` or `cancelled`
- `shipped` to `delivered`

Cancelling an order puts its units back in stock.

### Example

```bash
export WH_KEY=wh_xxxxxxxx
curl -H "x-api-key: $WH_KEY" "https://triathon-warehouse-simple.vercel.app/api/v1/products?brand=Tech&limit=5"

curl -X POST -H "x-api-key: $WH_KEY" -H "Content-Type: application/json" \
  -d '{"items":[{"product_id":"C32_TECH_001","quantity":2}]}' \
  https://triathon-warehouse-simple.vercel.app/api/v1/orders
```

### Errors

Errors look like `{ "error": { "code": "...", "message": "..." } }`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_json` | Body isn't valid JSON |
| 401 | `unauthorized` | Key is missing, invalid or revoked |
| 404 | `product_not_found`, `order_not_found` | Unknown product or order |
| 409 | `insufficient_stock`, `invalid_transition` | Not enough stock, or a status change that isn't allowed |
| 422 | `validation_error` | Body has the wrong shape |

## Project layout

```
prisma/schema.prisma         data model
prisma/init.sql              generated schema SQL (applied by scripts/db-apply.ts)
prisma/seed.ts               CSV import
scripts/                     DB apply script and shared libSQL client
src/lib/orders.ts            order creation, stock and status rules (used by the UI and the API)
src/lib/apiKey.ts            key generation and authentication
src/lib/auth.ts, session.ts  passwords and session cookie
src/app/api/v1/              public REST API
src/app/(auth)/              login and register
src/app/(app)/               dashboard, products, orders, API keys, docs
src/middleware.ts            redirects signed-out users to /login
```
