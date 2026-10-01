import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api";
import { prisma } from "@/lib/db";
import { releaseExpiredReservations } from "@/lib/orders";
import { WAREHOUSES } from "@/lib/warehouses";

export const GET = withApiKey(async () => {
  await releaseExpiredReservations();
  const [stock, orders] = await Promise.all([
    prisma.stock.groupBy({ by: ["warehouseId"], _sum: { quantity: true, reserved: true } }),
    prisma.order.groupBy({ by: ["warehouseId", "status"], _count: { _all: true } }),
  ]);
  // Units available per warehouse and temperature (ambient / chilled).
  const byTemp = await prisma.$queryRawUnsafe<{ w: string; t: string; q: unknown; r: unknown }[]>(
    `SELECT s.warehouseId AS w, p.tempRequirement AS t, SUM(s.quantity) AS q, SUM(s.reserved) AS r
     FROM "Stock" s JOIN "Product" p ON p.id = s.productId GROUP BY s.warehouseId, p.tempRequirement`,
  );
  const data = WAREHOUSES.map((w) => {
    const s = stock.find((x) => x.warehouseId === w.code);
    const byStatus = Object.fromEntries(orders.filter((o) => o.warehouseId === w.code).map((o) => [o.status, o._count._all]));
    return {
      code: w.code,
      name: w.name,
      units_available: s?._sum.quantity ?? 0,
      units_reserved: s?._sum.reserved ?? 0,
      by_temperature: Object.fromEntries(
        byTemp.filter((x) => x.w === w.code).map((x) => [x.t, { available: Number(x.q), reserved: Number(x.r) }]),
      ),
      orders: byStatus,
    };
  });
  return NextResponse.json({ data });
});
