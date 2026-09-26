# Warehouse Simple

Small warehouse app: login/register, dashboard, products & orders UI, and a REST API authenticated with user-managed API keys.
Next.js 15 + Prisma + libSQL (SQLite file locally, [Turso](https://turso.tech) in production), deployable to Vercel.

Data is seeded from `products.csv` (280 products) and `order_products.csv` (~194k lines, 97k orders).

## Run locally

```bash
npm install
cp .env.example .env          # set JWT_SECRET to a long random string
npm run db:setup              # create tables + seed CSVs (~20s)
npm run dev                   # http://localhost:3000
```

Demo login: `demo@warehouse.local` / `demo1234` (or register a new account).

Scripts:

| Script | What it does |
|---|---|
| `npm run db:apply` | Create tables from `prisma/init.sql` (idempotent) |
| `npm run db:seed` | Wipe and reload products/orders from the CSVs (users and API keys are kept) |
| `npm run db:setup` | Both of the above |
| `npm run db:sql` | Regenerate `prisma/init.sql` after editing `prisma/schema.prisma` |

## Deploy to Vercel

Vercel functions have no persistent disk, so production uses a hosted libSQL database (Turso, free tier).
The app uses `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` when set, otherwise `DATABASE_URL`/`DATABASE_AUTH_TOKEN`.

```bash
vercel link
vercel integration add tursocloud/database   # creates the DB, sets TURSO_* env vars on the project
vercel env pull .env.production.local --environment production
# seed the remote DB from your machine (loads .env.production.local values first)
npx dotenv -e .env.production.local -- npm run db:setup
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | vercel env add JWT_SECRET production
vercel --prod
```

Or manually: create a DB with the Turso CLI (`turso db create`, `turso db tokens create`), run
`DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npm run db:setup`, and set `DATABASE_URL`,
`DATABASE_AUTH_TOKEN`, `JWT_SECRET` in the Vercel project settings.

## API

Create a key on **API keys** in the dashboard (shown once). Send it as `x-api-key: <key>` or `Authorization: Bearer <key>`.
Full reference with curl examples is at `/docs` in the app.

| Method | Path | |
|---|---|---|
| GET | `/api/v1/products?brand=&q=&page=&limit=` | List products |
| GET | `/api/v1/products/:id` | One product |
| PATCH | `/api/v1/products/:id` | `{ "stock": n }` or `{ "adjust": ±n }` |
| GET | `/api/v1/orders?status=&page=&limit=` | List orders |
| GET | `/api/v1/orders/:id` | One order with items (id = `ORD0000001`) |
| POST | `/api/v1/orders` | `{ "items": [{ "product_id", "quantity" }] }` — decrements stock, 409 if insufficient |
| PUT | `/api/v1/orders/:id/status` | `{ "status" }` — pending→shipped/cancelled, shipped→delivered; cancel restores stock |

## Notes

- Products get a starting stock of 1000 each; seeded historical orders are `delivered` and do not consume stock.
- Seeded order dates are spread across the past year so the dashboard has a timeline.
- All users share the same warehouse data; each user manages their own API keys (stored as SHA-256 hashes).
