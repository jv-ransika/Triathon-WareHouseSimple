import { NextResponse } from "next/server";
import { pageParams, tempParam, warehouseParam, withApiKey } from "@/lib/api";
import { releaseExpiredReservations } from "@/lib/orders";
import { listProducts, productJson } from "@/lib/queries";

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const { page, limit, skip } = pageParams(url);
  const warehouse = warehouseParam(url);
  await releaseExpiredReservations();
  const { total, items } = await listProducts({
    brand: url.searchParams.get("brand"),
    temp: tempParam(url),
    q: url.searchParams.get("q"),
    sort: url.searchParams.get("sort"),
    lowStock: url.searchParams.get("low_stock") === "true",
    warehouse,
    skip,
    limit,
  });
  return NextResponse.json({ data: items.map(productJson), page, limit, total });
});
