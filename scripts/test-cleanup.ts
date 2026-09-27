// Removes data created by the e2e suite: users e2e-*@test.local, their API keys and
// orders. Stock their orders took (or locked) is returned to each order's warehouse first.
import type { InStatement } from "@libsql/client";
import { dbClient } from "./libsql";

async function main() {
  const db = dbClient();
  const users = await db.execute(`SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local'`);
  const ids = users.rows.map((r) => r.id as string);
  if (ids.length === 0) return console.log("Nothing to clean up");
  const inList = ids.map(() => "?").join(",");

  // Units per (warehouse, product) still taken (pending/shipped/delivered) or locked (reserved).
  const held = await db.execute({
    sql: `SELECT o.warehouseId AS w, oi.productId AS p,
            SUM(CASE WHEN o.status = 'reserved' THEN 0 ELSE oi.quantity END) AS taken,
            SUM(CASE WHEN o.status = 'reserved' THEN oi.quantity ELSE 0 END) AS locked
          FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId
          WHERE o.createdById IN (${inList}) AND o.status NOT IN ('cancelled', 'expired')
          GROUP BY o.warehouseId, oi.productId`,
    args: ids,
  });

  const restock: InStatement[] = held.rows.map((r) => ({
    sql: `UPDATE "Stock" SET quantity = quantity + ?, reserved = reserved - ? WHERE warehouseId = ? AND productId = ?`,
    args: [Number(r.taken) + Number(r.locked), Number(r.locked), r.w as string, r.p as string],
  }));

  const res = await db.batch(
    [
      ...restock,
      { sql: `DELETE FROM "OrderItem" WHERE orderId IN (SELECT id FROM "Order" WHERE createdById IN (${inList}))`, args: ids },
      { sql: `DELETE FROM "Order" WHERE createdById IN (${inList})`, args: ids },
      { sql: `DELETE FROM "ApiKey" WHERE userId IN (${inList})`, args: ids },
      { sql: `DELETE FROM "User" WHERE id IN (${inList})`, args: ids },
    ],
    "write",
  );
  const orders = res[restock.length + 1].rowsAffected;
  console.log(`Removed ${ids.length} test user(s), ${orders} order(s); restocked ${restock.length} warehouse/product row(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
