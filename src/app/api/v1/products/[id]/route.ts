import { NextResponse } from "next/server";
import { apiError, readJson, withApiKey } from "@/lib/api";
import { releaseExpiredReservations, setProductStock } from "@/lib/orders";
import { getProduct, productJson } from "@/lib/queries";

export const GET = withApiKey<{ id: string }>(async (_req, _auth, { id }) => {
  await releaseExpiredReservations();
  const product = await getProduct(id);
  if (!product) return apiError(404, "product_not_found", `Product ${id} not found`);
  return NextResponse.json({ data: productJson(product) });
});

export const PATCH = withApiKey<{ id: string }>(async (req, _auth, { id }) => {
  const product = await setProductStock(id, await readJson(req));
  return NextResponse.json({ data: productJson(product) });
});
