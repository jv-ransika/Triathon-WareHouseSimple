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
  const data = WAREHOUSES.map((w) => {
    const s = stock.find((x) => x.warehouseId === w.code);
    const byStatus = Object.fromEntries(orders.filter((o) => o.warehouseId === w.code).map((o) => [o.status, o._count._all]));
    return {
      code: w.code,
      name: w.name,
      units_available: s?._sum.quantity ?? 0,
      units_reserved: s?._sum.reserved ?? 0,
      orders: byStatus,
    };
  });
  return NextResponse.json({ data });
});
