import { NextResponse } from "next/server";
import { pageParams, readJson, warehouseParam, withApiKey } from "@/lib/api";
import { createOrder, releaseExpiredReservations } from "@/lib/orders";
import { listOrders, orderJson } from "@/lib/queries";

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const { page, limit, skip } = pageParams(url);
  await releaseExpiredReservations();
  const { total, items } = await listOrders({ status: url.searchParams.get("status"), warehouse: warehouseParam(url), skip, limit });
  return NextResponse.json({ data: items.map(orderJson), page, limit, total });
});

// 201: fully available, order is pending.
// 202: partially available, available units are locked and the order is "reserved"
//      until POST /orders/:id/confirm, cancellation, or expires_at.
export const POST = withApiKey(async (req, auth) => {
  const { order, shortfall } = await createOrder(await readJson(req), auth.userId, "api");
  if (order.status === "reserved") {
    return NextResponse.json(
      {
        data: orderJson(order),
        shortfall,
        message: `Not enough stock for every line. Available units are reserved until ${order.expiresAt?.toISOString()}. Confirm with POST /api/v1/orders/${order.code}/confirm or cancel with PUT /api/v1/orders/${order.code}/status {"status":"cancelled"}.`,
      },
      { status: 202 },
    );
  }
  return NextResponse.json({ data: orderJson(order) }, { status: 201 });
});
