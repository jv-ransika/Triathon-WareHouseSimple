import { NextResponse } from "next/server";
import { pageParams, readJson, withApiKey } from "@/lib/api";
import { createOrder } from "@/lib/orders";
import { listOrders, orderJson } from "@/lib/queries";

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const { page, limit, skip } = pageParams(url);
  const { total, items } = await listOrders({ status: url.searchParams.get("status"), skip, limit });
  return NextResponse.json({ data: items.map(orderJson), page, limit, total });
});

export const POST = withApiKey(async (req, auth) => {
  const order = await createOrder(await readJson(req), auth.userId, "api");
  return NextResponse.json({ data: orderJson(order) }, { status: 201 });
});
