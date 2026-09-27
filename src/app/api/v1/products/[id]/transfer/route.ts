import { NextResponse } from "next/server";
import { readJson, withApiKey } from "@/lib/api";
import { transferStock } from "@/lib/orders";
import { productJson } from "@/lib/queries";

export const POST = withApiKey<{ id: string }>(async (req, _auth, { id }) => {
  const product = await transferStock(id, await readJson(req));
  return NextResponse.json({ data: productJson(product) });
});
