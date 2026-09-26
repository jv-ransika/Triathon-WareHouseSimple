import { NextResponse } from "next/server";
import { pageParams, withApiKey } from "@/lib/api";
import { listProducts, productJson } from "@/lib/queries";

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const { page, limit, skip } = pageParams(url);
  const { total, items } = await listProducts({
    brand: url.searchParams.get("brand"),
    q: url.searchParams.get("q"),
    skip,
    limit,
  });
  return NextResponse.json({ data: items.map(productJson), page, limit, total });
});
