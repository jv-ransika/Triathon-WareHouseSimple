// Removes data created by the e2e suite: users e2e-*@test.local, their API keys and
// orders. Stock taken by their non-cancelled orders is returned first.
import { dbClient } from "./libsql";

async function main() {
  const db = dbClient();
  const users = await db.execute(`SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local'`);
  const ids = users.rows.map((r) => r.id as string);
  if (ids.length === 0) return console.log("Nothing to clean up");
  const inList = ids.map(() => "?").join(",");

  const res = await db.batch(
    [
      {
        sql: `UPDATE "Product" SET stock = stock + (
                SELECT SUM(oi.quantity) FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId
                WHERE oi.productId = "Product".id AND o.status != 'cancelled' AND o.createdById IN (${inList}))
              WHERE id IN (SELECT oi.productId FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId
                WHERE o.status != 'cancelled' AND o.createdById IN (${inList}))`,
        args: [...ids, ...ids],
      },
      { sql: `DELETE FROM "OrderItem" WHERE orderId IN (SELECT id FROM "Order" WHERE createdById IN (${inList}))`, args: ids },
      { sql: `DELETE FROM "Order" WHERE createdById IN (${inList})`, args: ids },
      { sql: `DELETE FROM "ApiKey" WHERE userId IN (${inList})`, args: ids },
      { sql: `DELETE FROM "User" WHERE id IN (${inList})`, args: ids },
    ],
    "write",
  );
  console.log(`Removed ${ids.length} test user(s), ${res[2].rowsAffected} order(s); restocked ${res[0].rowsAffected} product(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
