"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateApiKey } from "@/lib/apiKey";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createOrder, setProductStock, updateOrderStatus } from "@/lib/orders";

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

export async function updateStockAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  try {
    await setProductStock(String(form.get("id")), { stock: Number(form.get("stock")) });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/products");
  return {};
}

export async function createOrderAction(items: { product_id: string; quantity: number }[]): Promise<ActionResult> {
  const user = await requireUser();
  let code: string;
  try {
    code = (await createOrder({ items }, user.id, "ui")).code;
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/orders");
  redirect(`/orders/${code}`);
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
