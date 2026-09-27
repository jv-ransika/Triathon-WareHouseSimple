// Applies prisma/init.sql to the database (local file or Turso). Safe to re-run.
// --reset-data drops the warehouse/product/order tables first (for schema changes);
// User and ApiKey tables are never dropped.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbClient } from "./libsql";

async function main() {
  const sql = readFileSync(join(process.cwd(), "prisma", "init.sql"), "utf8")
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/CREATE (UNIQUE )?INDEX "/g, (_m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS "`);
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

  const db = dbClient();
  if (process.argv.includes("--reset-data")) {
    const drops = ["OrderItem", "Order", "Stock", "Warehouse", "Product"].map((t) => `DROP TABLE IF EXISTS "${t}"`);
    await db.batch(["PRAGMA foreign_keys = OFF", ...drops], "write");
    console.log("Dropped warehouse/product/order tables (users and API keys kept)");
  }
  await db.batch(statements, "write");
  console.log(`Applied ${statements.length} statements`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
