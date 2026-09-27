"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateApiKey } from "@/lib/apiKey";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { confirmOrder, createOrder, setProductStock, transferStock, updateOrderStatus } from "@/lib/orders";
import { WAREHOUSE_COOKIE } from "@/lib/warehouseScope";
import { parseWarehouse } from "@/lib/warehouses";

export type ActionResult = { error?: string; key?: string } | undefined;

function toResult(e: unknown): ActionResult {
  if (e instanceof AppError) return { error: e.message };
  // redirect() throws; let it propagate.
  throw e;
}

export async function createApiKeyAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const name = z.string().trim().min(1).max(60).safeParse(form.get("name"));
  if (!name.success) return { error: "Name is required (max 60 chars)" };

  const { key, prefix, keyHash } = generateApiKey();
  await prisma.apiKey.create({ data: { userId: user.id, name: name.data, prefix, keyHash } });
  revalidatePath("/api-keys");
  return { key };
}

export async function revokeApiKeyAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  // Scoped to owner: users can only revoke their own keys.
  await prisma.apiKey.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/api-keys");
}

export async function deleteApiKeyAction(form: FormData) {
  const user = await requireUser();
  await prisma.apiKey.deleteMany({ where: { id: String(form.get("id")), userId: user.id } });
  revalidatePath("/api-keys");
}

/** Sidebar switcher: scope pages to one warehouse, or "all". */
export async function setWarehouseAction(form: FormData) {
  await requireUser();
  const code = parseWarehouse(form.get("warehouse"));
  const jar = await cookies();
  if (code) jar.set(WAREHOUSE_COOKIE, code, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(WAREHOUSE_COOKIE);
  revalidatePath("/", "layout");
}

export async function updateStockAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  try {
    await setProductStock(String(form.get("id")), { warehouse: String(form.get("warehouse")), stock: Number(form.get("stock")) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/products");
  return {};
}

export async function transferStockAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  try {
    await transferStock(String(form.get("id")), {
      from: String(form.get("from")),
      to: String(form.get("to")),
      quantity: Number(form.get("quantity")),
    });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/products");
  return {};
}

export async function createOrderAction(
  warehouse: string,
  items: { product_id: string; quantity: number }[],
): Promise<ActionResult> {
  const user = await requireUser();
  let code: string;
  try {
    code = (await createOrder({ warehouse, items }, user.id, "ui")).order.code;
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/orders");
  redirect(`/orders/${code}`);
}

export async function confirmOrderAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const code = String(form.get("code"));
  try {
    await confirmOrder(code);
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/orders/${code}`);
  return {};
}

export async function updateOrderStatusAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const code = String(form.get("code"));
  try {
    await updateOrderStatus(code, form.get("status"));
  } catch (e) {
    return toResult(e);
  }
  revalidatePath(`/orders/${code}`);
  return {};
}
