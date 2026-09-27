// Seeds warehouses, products, per-warehouse stock and historical orders from the
// CSV files. Re-runnable: wipes those tables first, never touches User/ApiKey
// (except creating the demo user). Historical orders alternate by order number:
// odd -> Kandy (KDY), even -> Peliyagoda (PLG).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import bcrypt from "bcryptjs";
import type { InStatement, InValue } from "@libsql/client";
import { dbClient } from "../scripts/libsql";

const CHUNK = 500;
const DEFAULT_STOCK = 1000; // per product, per warehouse
const WAREHOUSES = [
  ["KDY", "Kandy"],
  ["PLG", "Peliyagoda"],
] as const;
const root = process.cwd();

type ProductRow = {
  product_id: string;
  brand: string;
  unit_weight_kg: string;
  unit_volume_m3: string;
  basis: string;
  verified_real_sku: string;
};
type OrderRow = { order_id: string; product_id: string; quantity: string };

function readCsv<T>(file: string): T[] {
  return parse(readFileSync(join(root, file)), { columns: true, skip_empty_lines: true, trim: true });
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function multiInsert(table: string, cols: string[], rows: unknown[][]): InStatement {
  const placeholders = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  return {
    sql: `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`,
    args: rows.flat() as InValue[],
  };
}

async function main() {
  const db = dbClient();
  const now = new Date();

  const products = readCsv<ProductRow>("products.csv");
  const lines = readCsv<OrderRow>("order_products.csv");
  console.log(`CSV: ${products.length} products, ${lines.length} order lines`);

  const productMap = new Map(products.map((p) => [p.product_id, p]));

  // Group lines into orders; spread seeded order dates over the past 365 days
  // (order number order == chronological order) so the dashboard has a timeline.
  const orders = new Map<string, { weight: number; volume: number; items: [string, number][] }>();
  let skipped = 0;
  for (const l of lines) {
    const p = productMap.get(l.product_id);
    const qty = Number(l.quantity);
    if (!p || !Number.isFinite(qty) || qty <= 0) {
      skipped++;
      continue;
    }
    let o = orders.get(l.order_id);
    if (!o) orders.set(l.order_id, (o = { weight: 0, volume: 0, items: [] }));
    o.weight += qty * Number(p.unit_weight_kg);
    o.volume += qty * Number(p.unit_volume_m3);
    o.items.push([l.product_id, qty]);
  }
  if (skipped) console.warn(`Skipped ${skipped} lines with unknown product or bad quantity`);

  console.log("Clearing existing warehouses/products/orders…");
  await db.batch(
    ['DELETE FROM "OrderItem"', 'DELETE FROM "Order"', 'DELETE FROM "Stock"', 'DELETE FROM "Product"', 'DELETE FROM "Warehouse"'],
    "write",
  );

  await db.batch([multiInsert("Warehouse", ["id", "name", "createdAt"], WAREHOUSES.map(([id, name]) => [id, name, now.toISOString()]))], "write");

  console.log("Inserting products…");
  const productRows = products.map((p) => [
    p.product_id,
    p.brand,
    Number(p.unit_weight_kg),
    Number(p.unit_volume_m3),
    p.basis,
    p.verified_real_sku.toLowerCase() === "true" ? 1 : 0,
    now.toISOString(),
  ]);
  await db.batch(
    chunks(productRows, CHUNK).map((rows) =>
      multiInsert("Product", ["id", "brand", "unitWeightKg", "unitVolumeM3", "basis", "verifiedRealSku", "updatedAt"], rows),
    ),
    "write",
  );

  console.log("Inserting stock…");
  const stockRows = WAREHOUSES.flatMap(([wid]) => products.map((p) => [wid, p.product_id, DEFAULT_STOCK, 0, now.toISOString()]));
  await db.batch(
    chunks(stockRows, CHUNK).map((rows) => multiInsert("Stock", ["warehouseId", "productId", "quantity", "reserved", "updatedAt"], rows)),
    "write",
  );

  const orderEntries = [...orders.entries()].sort(([a], [b]) => a.localeCompare(b));
  const yearMs = 365 * 24 * 3600 * 1000;
  const start = now.getTime() - yearMs;
  const orderRows: unknown[][] = [];
  const itemRows: unknown[][] = [];
  orderEntries.forEach(([code, o], i) => {
    const id = Number(code.replace(/\D/g, "")) || i + 1;
    const createdAt = new Date(start + Math.floor((i / orderEntries.length) * yearMs)).toISOString();
    const warehouseId = id % 2 === 1 ? "KDY" : "PLG";
    orderRows.push([id, code, "delivered", "seed", warehouseId, o.weight, o.volume, createdAt]);
    for (const [pid, qty] of o.items) itemRows.push([id, pid, qty, qty]);
  });

  console.log(`Inserting ${orderRows.length} orders…`);
  // Batches of ~20 statements x 500 rows keep each request well under Turso limits.
  const orderStmts = chunks(orderRows, CHUNK).map((rows) =>
    multiInsert("Order", ["id", "code", "status", "source", "warehouseId", "totalWeightKg", "totalVolumeM3", "createdAt"], rows),
  );
  for (const group of chunks(orderStmts, 20)) await db.batch(group, "write");

  console.log(`Inserting ${itemRows.length} order items…`);
  const itemStmts = chunks(itemRows, CHUNK).map((rows) => multiInsert("OrderItem", ["orderId", "productId", "quantity", "requestedQuantity"], rows));
  let done = 0;
  for (const group of chunks(itemStmts, 20)) {
    await db.batch(group, "write");
    done += group.length * CHUNK;
    process.stdout.write(`\r  ${Math.min(done, itemRows.length)}/${itemRows.length}`);
  }
  process.stdout.write("\n");

  const demo = await db.execute({ sql: 'SELECT id FROM "User" WHERE email = ?', args: ["demo@warehouse.local"] });
  if (demo.rows.length === 0) {
    await db.execute({
      sql: 'INSERT INTO "User" (id, email, name, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)',
      args: [crypto.randomUUID(), "demo@warehouse.local", "Demo User", await bcrypt.hash("demo1234", 10), now.toISOString()],
    });
    console.log("Created demo user demo@warehouse.local / demo1234");
  }

  const counts = await db.execute(
    `SELECT (SELECT COUNT(*) FROM "Warehouse") w, (SELECT COUNT(*) FROM "Product") p, (SELECT COUNT(*) FROM "Stock") s,
       (SELECT COUNT(*) FROM "Order") o, (SELECT COUNT(*) FROM "Order" WHERE warehouseId = 'KDY') kdy,
       (SELECT COUNT(*) FROM "OrderItem") i, (SELECT COUNT(*) FROM "User") u`,
  );
  console.log("Done:", counts.rows[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
