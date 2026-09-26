// Applies prisma/init.sql to DATABASE_URL (local file or Turso). Safe to re-run.
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
  await db.batch(statements, "write");
  console.log(`Applied ${statements.length} statements to ${process.env.DATABASE_URL}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
