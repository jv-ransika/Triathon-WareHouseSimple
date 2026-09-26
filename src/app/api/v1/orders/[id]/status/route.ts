import { NextResponse } from "next/server";
import { readJson, withApiKey } from "@/lib/api";
import { updateOrderStatus } from "@/lib/orders";
import { orderJson } from "@/lib/queries";

const handler = withApiKey<{ id: string }>(async (req, _auth, { id }) => {
  const body = await readJson(req);
  const order = await updateOrderStatus(id.toUpperCase(), body?.status);
  return NextResponse.json({ data: orderJson(order) });
});

export { handler as PUT, handler as PATCH };
