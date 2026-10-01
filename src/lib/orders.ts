import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";
import { otherWarehouse, resolveWarehouse, warehouseName, type WarehouseCode } from "./warehouses";

export const ORDER_STATUSES = ["reserved", "pending", "shipped", "delivered", "cancelled", "expired"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** How long stock stays locked for an order awaiting confirmation. */
export const RESERVATION_MINUTES = Math.max(1, Number(process.env.RESERVATION_MINUTES) || 15);

type Tx = Prisma.TransactionClient;

export const createOrderSchema = z.object({
  warehouse: z.string({ error: "warehouse is required" }),
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

const stockKey = (warehouseId: string, productId: string) => ({ warehouseId_productId: { warehouseId, productId } });

/** Merge duplicate product lines so each product is handled once. */
function mergeItems(items: { product_id: string; quantity: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.product_id, (merged.get(i.product_id) ?? 0) + i.quantity);
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Return locked units of a reserved order to available stock. */
async function releaseLocked(tx: Tx, order: { warehouseId: string; items: { productId: string; quantity: number }[] }) {
  for (const item of order.items) {
    if (item.quantity === 0) continue;
    await tx.stock.update({
      where: stockKey(order.warehouseId, item.productId),
      data: { reserved: { decrement: item.quantity }, quantity: { increment: item.quantity } },
    });
  }
}

/**
 * Expire reservations past their deadline and release their stock. There is no cron
 * (Vercel hobby), so this runs lazily before reads/writes that depend on stock.
 */
export async function releaseExpiredReservations() {
  const due = await prisma.order.findMany({
    where: { status: "reserved", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const { id } of due) {
    await prisma.$transaction(async (tx) => {
      // Conditional status change so concurrent callers release only once.
      const changed = await tx.order.updateMany({ where: { id, status: "reserved" }, data: { status: "expired" } });
      if (changed.count === 0) return;
      const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
      await releaseLocked(tx, order);
    });
  }
  return due.length;
}

export type Shortfall = {
  product_id: string;
  requested: number;
  reserved: number;
  shortfall: number;
  other_warehouse: { code: WarehouseCode; name: string; available: number };
};

/** Lines of a reserved order that could not be fully locked, with the other warehouse's availability. */
export async function getShortfall(order: {
  warehouseId: string;
  items: { productId: string; quantity: number; requestedQuantity: number }[];
}): Promise<Shortfall[]> {
  const short = order.items.filter((i) => i.quantity < i.requestedQuantity);
  if (short.length === 0) return [];
  const other = otherWarehouse(order.warehouseId as WarehouseCode);
  const stocks = await prisma.stock.findMany({ where: { warehouseId: other, productId: { in: short.map((i) => i.productId) } } });
  const avail = new Map(stocks.map((s) => [s.productId, s.quantity]));
  return short.map((i) => ({
    product_id: i.productId,
    requested: i.requestedQuantity,
    reserved: i.quantity,
    shortfall: i.requestedQuantity - i.quantity,
    other_warehouse: { code: other, name: warehouseName(other), available: avail.get(i.productId) ?? 0 },
  }));
}

/**
 * Place an order against one warehouse.
 * - Everything available: stock is taken, order is "pending".
 * - Some lines short: whatever is available is locked (moved to Stock.reserved) and the
 *   order is "reserved" until confirmed, cancelled or expired.
 * - Nothing available at all: 409, nothing is locked.
 */
export async function createOrder(input: unknown, userId: string | null, source: "ui" | "api") {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) throw new AppError(422, "validation_error", "Invalid order payload", parsed.error.issues);
  const warehouseId = resolveWarehouse(parsed.data.warehouse);
  const items = mergeItems(parsed.data.items);

  await releaseExpiredReservations();

  const order = await prisma.$transaction(async (tx) => {
    const ids = items.map((i) => i.productId);
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new AppError(404, "product_not_found", `Unknown product(s): ${missing.join(", ")}`);

    const stocks = await tx.stock.findMany({ where: { warehouseId, productId: { in: ids } } });
    const available = new Map(stocks.map((s) => [s.productId, s.quantity]));

    const plan = items.map((i) => ({ ...i, lock: Math.min(i.quantity, available.get(i.productId) ?? 0) }));
    const complete = plan.every((p) => p.lock === p.quantity);
    if (plan.every((p) => p.lock === 0)) {
      const detail = plan.map((p) => `${p.productId}: requested ${p.quantity}, available 0`).join("; ");
      throw new AppError(409, "insufficient_stock", `No stock available in ${warehouseName(warehouseId)} (${detail})`);
    }

    let totalWeightKg = 0;
    let totalVolumeM3 = 0;
    for (const p of plan) {
      const product = byId.get(p.productId)!;
      totalWeightKg += product.unitWeightKg * p.lock;
      totalVolumeM3 += product.unitVolumeM3 * p.lock;
      if (p.lock === 0) continue;
      // Conditional decrement guards against a concurrent order taking the same units.
      const res = await tx.stock.updateMany({
        where: { warehouseId, productId: p.productId, quantity: { gte: p.lock } },
        data: complete ? { quantity: { decrement: p.lock } } : { quantity: { decrement: p.lock }, reserved: { increment: p.lock } },
      });
      if (res.count === 0) throw new AppError(409, "stock_changed", `Stock for ${p.productId} changed while ordering, please retry`);
    }

    // Orders carry the temperature of their products ("mixed" if both are present).
    const temps = new Set(plan.map((p) => byId.get(p.productId)!.tempRequirement));
    const tempRequirement = temps.size === 1 ? [...temps][0] : "mixed";

    const created = await tx.order.create({
      data: {
        code: `TMP-${randomUUID()}`,
        tempRequirement,
        status: complete ? "pending" : "reserved",
        expiresAt: complete ? null : new Date(Date.now() + RESERVATION_MINUTES * 60_000),
        source,
        warehouseId,
        createdById: userId,
        totalWeightKg,
        totalVolumeM3,
        items: { create: plan.map((p) => ({ productId: p.productId, quantity: p.lock, requestedQuantity: p.quantity })) },
      },
    });
    return tx.order.update({ where: { id: created.id }, data: { code: orderCode(created.id) }, include: { items: true } });
  });

  return { order, shortfall: await getShortfall(order) };
}

/** Accept a reserved (partially available) order: locked units become a normal pending order. */
export async function confirmOrder(code: string) {
  await releaseExpiredReservations();
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { code }, include: { items: true } });
    if (!order) throw new AppError(404, "order_not_found", `Order ${code} not found`);
    if (order.status === "expired") throw new AppError(409, "reservation_expired", `Reservation for ${code} has expired`);
    if (order.status !== "reserved") throw new AppError(409, "invalid_transition", `Only reserved orders can be confirmed (status is ${order.status})`);

    const changed = await tx.order.updateMany({ where: { id: order.id, status: "reserved" }, data: { status: "pending", expiresAt: null } });
    if (changed.count === 0) throw new AppError(409, "invalid_transition", `Order ${code} changed, please reload`);
    for (const item of order.items) {
      if (item.quantity === 0) continue;
      await tx.stock.update({ where: stockKey(order.warehouseId, item.productId), data: { reserved: { decrement: item.quantity } } });
    }
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  });
}

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  reserved: ["pending", "cancelled"],
  pending: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  expired: [],
};

export async function updateOrderStatus(code: string, status: unknown) {
  const next = z.enum(ORDER_STATUSES).safeParse(status);
  if (!next.success) throw new AppError(422, "validation_error", `status must be one of: ${ORDER_STATUSES.join(", ")}`);

  await releaseExpiredReservations();
  const existing = await prisma.order.findUnique({ where: { code }, select: { status: true } });
  if (!existing) throw new AppError(404, "order_not_found", `Order ${code} not found`);
  if (existing.status === "reserved" && next.data === "pending") return confirmOrder(code);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { code }, include: { items: true } });
    const current = order.status as OrderStatus;
    if (current === next.data) return order;
    if (!ALLOWED_TRANSITIONS[current]?.includes(next.data)) {
      throw new AppError(409, "invalid_transition", `Cannot change status from ${current} to ${next.data}`);
    }
    const changed = await tx.order.updateMany({
      where: { id: order.id, status: current },
      data: { status: next.data, ...(next.data === "cancelled" ? { expiresAt: null } : {}) },
    });
    if (changed.count === 0) throw new AppError(409, "invalid_transition", `Order ${code} changed, please reload`);

    if (next.data === "cancelled") {
      if (current === "reserved") await releaseLocked(tx, order);
      else {
        for (const item of order.items) {
          await tx.stock.update({ where: stockKey(order.warehouseId, item.productId), data: { quantity: { increment: item.quantity } } });
        }
      }
    }
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  });
}

const stockBodySchema = z.union([
  z.object({ warehouse: z.string(), stock: z.number().int().min(0) }),
  z.object({ warehouse: z.string(), adjust: z.number().int() }),
]);

/** Set or adjust the available stock of a product in one warehouse. */
export async function setProductStock(id: string, body: unknown) {
  const parsed = stockBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(422, "validation_error", 'Body must be { "warehouse": "KDY", "stock": int >= 0 } or { "warehouse": "KDY", "adjust": int }');
  }
  const warehouseId = resolveWarehouse(parsed.data.warehouse);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, "product_not_found", `Product ${id} not found`);

  if ("stock" in parsed.data) {
    const stock = parsed.data.stock;
    await prisma.stock.upsert({
      where: stockKey(warehouseId, id),
      create: { warehouseId, productId: id, quantity: stock },
      update: { quantity: stock },
    });
  } else {
    const adjust = parsed.data.adjust;
    await prisma.stock.upsert({ where: stockKey(warehouseId, id), create: { warehouseId, productId: id, quantity: 0 }, update: {} });
    const res = await prisma.stock.updateMany({
      where: { warehouseId, productId: id, quantity: { gte: Math.max(0, -adjust) } },
      data: { quantity: { increment: adjust } },
    });
    if (res.count === 0) {
      const current = await prisma.stock.findUnique({ where: stockKey(warehouseId, id) });
      throw new AppError(409, "insufficient_stock", `Stock in ${warehouseName(warehouseId)} cannot go below 0 (current ${current?.quantity ?? 0})`);
    }
  }
  return prisma.product.findUniqueOrThrow({ where: { id }, include: { stocks: true } });
}

const transferSchema = z.object({ from: z.string(), to: z.string(), quantity: z.number().int().positive() });

/** Move available units of a product from one warehouse to the other. */
export async function transferStock(id: string, body: unknown) {
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) throw new AppError(422, "validation_error", 'Body must be { "from": "KDY", "to": "PLG", "quantity": int > 0 }');
  const from = resolveWarehouse(parsed.data.from, "from");
  const to = resolveWarehouse(parsed.data.to, "to");
  if (from === to) throw new AppError(422, "validation_error", "from and to must be different warehouses");
  const { quantity } = parsed.data;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, "product_not_found", `Product ${id} not found`);

  await prisma.$transaction(async (tx) => {
    const res = await tx.stock.updateMany({
      where: { warehouseId: from, productId: id, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (res.count === 0) {
      const current = await tx.stock.findUnique({ where: stockKey(from, id) });
      throw new AppError(
        409,
        "insufficient_stock",
        `Cannot transfer ${quantity} of ${id}: only ${current?.quantity ?? 0} available in ${warehouseName(from)}`,
      );
    }
    await tx.stock.upsert({
      where: stockKey(to, id),
      create: { warehouseId: to, productId: id, quantity },
      update: { quantity: { increment: quantity } },
    });
  });
  return prisma.product.findUniqueOrThrow({ where: { id }, include: { stocks: true } });
}
