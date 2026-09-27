import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api";
import { confirmOrder } from "@/lib/orders";
import { orderJson } from "@/lib/queries";

export const POST = withApiKey<{ id: string }>(async (_req, _auth, { id }) => {
  const order = await confirmOrder(id.toUpperCase());
  return NextResponse.json({ data: orderJson(order) });
});
