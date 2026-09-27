import { NextResponse } from "next/server";
import { apiError, withApiKey } from "@/lib/api";
import { getShortfall, releaseExpiredReservations } from "@/lib/orders";
import { getOrder, orderJson } from "@/lib/queries";

export const GET = withApiKey<{ id: string }>(async (_req, _auth, { id }) => {
  await releaseExpiredReservations();
  const order = await getOrder(id.toUpperCase());
  if (!order) return apiError(404, "order_not_found", `Order ${id} not found`);
  const shortfall = order.status === "reserved" ? await getShortfall(order) : undefined;
  return NextResponse.json({ data: orderJson(order), ...(shortfall ? { shortfall } : {}) });
});
