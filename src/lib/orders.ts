import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";

export const ORDER_STATUSES = ["pending", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
});

export const orderCode = (id: number) => `ORD${String(id).padStart(7, "0")}`;

/** Merge duplicate product lines so each product is decremented once. */
function mergeItems(items: { product_id: string; quantity: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.product_id, (merged.get(i.product_id) ?? 0) + i.quantity);
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export async function createOrder(input: unknown, userId: string | null, source: "ui" | "api") {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) throw new AppError(422, "validation_error", "Invalid order payload", parsed.error.issues);
  const items = mergeItems(parsed.data.items);

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = items.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
    if (missing.length) throw new AppError(404, "product_not_found", `Unknown product(s): ${missing.join(", ")}`);

    let totalWeightKg = 0;
    let totalVolumeM3 = 0;
    for (const item of items) {
      // Conditional decrement: fails atomically if stock is insufficient.
      const res = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (res.count === 0) {
        const p = byId.get(item.productId)!;
        throw new AppError(409, "insufficient_stock", `Insufficient stock for ${p.id}: requested ${item.quantity}, available ${p.stock}`);
      }
      const p = byId.get(item.productId)!;
      totalWeightKg += p.unitWeightKg * item.quantity;
      totalVolumeM3 += p.unitVolumeM3 * item.quantity;
    }

    const created = await tx.order.create({
      data: {
        code: `TMP-${randomUUID()}`,
        status: "pending",
        source,
        createdById: userId,
        totalWeightKg,
        totalVolumeM3,
        items: { create: items },
      },
    });
    return tx.order.update({
      where: { id: created.id },
      data: { code: orderCode(created.id) },
      include: { items: true },
    });
  });
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(code: string, status: unknown) {
  const next = z.enum(ORDER_STATUSES).safeParse(status);
  if (!next.success) throw new AppError(422, "validation_error", `status must be one of: ${ORDER_STATUSES.join(", ")}`);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { code }, include: { items: true } });
    if (!order) throw new AppError(404, "order_not_found", `Order ${code} not found`);
    const current = order.status as OrderStatus;
    if (current === next.data) return order;
    if (!ALLOWED_TRANSITIONS[current]?.includes(next.data)) {
      throw new AppError(409, "invalid_transition", `Cannot change status from ${current} to ${next.data}`);
    }
    if (next.data === "cancelled") {
      for (const item of order.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    }
    return tx.order.update({ where: { id: order.id }, data: { status: next.data }, include: { items: true } });
  });
}

export async function setProductStock(id: string, body: unknown) {
  const schema = z.union([
    z.object({ stock: z.number().int().min(0) }),
    z.object({ adjust: z.number().int() }),
  ]);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(422, "validation_error", "Body must be { stock: int >= 0 } or { adjust: int }");

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, "product_not_found", `Product ${id} not found`);

  if ("stock" in parsed.data) {
    return prisma.product.update({ where: { id }, data: { stock: parsed.data.stock } });
  }
  const adjust = parsed.data.adjust;
  if (product.stock + adjust < 0) throw new AppError(409, "insufficient_stock", `Stock cannot go below 0 (current ${product.stock})`);
  return prisma.product.update({ where: { id }, data: { stock: { increment: adjust } } });
}
