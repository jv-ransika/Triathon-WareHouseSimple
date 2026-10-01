import "server-only";
import type { Prisma, Product, Order, OrderItem, Stock } from "@prisma/client";
import { prisma } from "./db";
import { WAREHOUSES, warehouseName, type WarehouseCode } from "./warehouses";

export const LOW_STOCK = 50;
export const TEMPS = ["ambient", "chilled"] as const;
export const parseTemp = (v: unknown) => (typeof v === "string" && (TEMPS as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() : null);

export type ProductWithStocks = Product & { stocks: Stock[] };

/**
 * Lists products with their per-warehouse stock. Filtering/sorting by stock is done in SQL:
 * with a warehouse selected it uses that warehouse's available quantity, otherwise the
 * total (sort) or the lowest warehouse (low-stock filter).
 */
export async function listProducts(opts: {
  brand?: string | null;
  temp?: string | null;
  q?: string | null;
  sort?: string | null;
  warehouse?: WarehouseCode | null;
  lowStock?: boolean;
  skip: number;
  limit: number;
}): Promise<{ total: number; items: ProductWithStocks[] }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.warehouse) {
    args.push(opts.warehouse);
  }
  if (opts.brand) {
    where.push("p.brand = ?");
    args.push(opts.brand);
  }
  if (opts.temp) {
    where.push("p.tempRequirement = ?");
    args.push(opts.temp);
  }
  if (opts.q) {
    where.push("p.id LIKE ?");
    args.push(`%${opts.q.toUpperCase()}%`);
  }
  const join = opts.warehouse
    ? `LEFT JOIN "Stock" s ON s.productId = p.id AND s.warehouseId = ?`
    : `LEFT JOIN "Stock" s ON s.productId = p.id`;
  const having = opts.lowStock ? `HAVING ${opts.warehouse ? "COALESCE(MAX(s.quantity), 0)" : "COALESCE(MIN(s.quantity), 0)"} < ${LOW_STOCK}` : "";
  const base = `FROM "Product" p ${join} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY p.id ${having}`;
  const order = opts.sort === "stock" ? "COALESCE(SUM(s.quantity), 0) ASC, p.id ASC" : "p.id ASC";

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: unknown }[]>(`SELECT COUNT(*) AS n FROM (SELECT p.id ${base})`, ...args),
    prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT p.id AS id ${base} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, opts.limit, opts.skip),
  ]);
  const ids = idRows.map((r) => r.id);
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, include: { stocks: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  return { total: Number(countRows[0]?.n ?? 0), items: ids.map((id) => byId.get(id)!).filter(Boolean) };
}

export function getProduct(id: string) {
  return prisma.product.findUnique({ where: { id }, include: { stocks: true } });
}

export async function listOrders(opts: {
  status?: string | null;
  temp?: string | null;
  q?: string | null;
  warehouse?: WarehouseCode | null;
  skip: number;
  limit: number;
}) {
  const where: Prisma.OrderWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.warehouse) where.warehouseId = opts.warehouse;
  if (opts.temp) where.tempRequirement = opts.temp;
  if (opts.q) where.code = { contains: opts.q.toUpperCase() };
  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { id: "desc" },
      skip: opts.skip,
      take: opts.limit,
      include: { _count: { select: { items: true } } },
    }),
  ]);
  return { total, items };
}

export function getOrder(code: string) {
  return prisma.order.findUnique({
    where: { code },
    include: { items: { include: { product: true } }, createdBy: { select: { email: true, name: true } } },
  });
}

/** Per-warehouse stock, filling in zero for a warehouse with no Stock row. */
export function stockByWarehouse(stocks: Stock[]) {
  return Object.fromEntries(
    WAREHOUSES.map((w) => {
      const s = stocks.find((x) => x.warehouseId === w.code);
      return [w.code, { available: s?.quantity ?? 0, reserved: s?.reserved ?? 0 }];
    }),
  ) as Record<WarehouseCode, { available: number; reserved: number }>;
}

export const productJson = (p: ProductWithStocks) => {
  const stock = stockByWarehouse(p.stocks);
  return {
    product_id: p.id,
    brand: p.brand,
    temp_requirement: p.tempRequirement,
    unit_weight_kg: p.unitWeightKg,
    unit_volume_m3: p.unitVolumeM3,
    base_product_id: p.baseProductId,
    basis: p.basis,
    temperature_basis: p.temperatureBasis,
    verified_real_sku: p.verifiedRealSku,
    stock,
    total_available: Object.values(stock).reduce((s, x) => s + x.available, 0),
    total_reserved: Object.values(stock).reduce((s, x) => s + x.reserved, 0),
    updated_at: p.updatedAt,
  };
};

export const orderJson = (o: Order & { items?: OrderItem[]; _count?: { items: number } }) => ({
  order_id: o.code,
  status: o.status,
  warehouse: { code: o.warehouseId, name: warehouseName(o.warehouseId) },
  temp_requirement: o.tempRequirement,
  source: o.source,
  total_weight_kg: Number(o.totalWeightKg.toFixed(3)),
  total_volume_m3: Number(o.totalVolumeM3.toFixed(4)),
  expires_at: o.expiresAt,
  created_at: o.createdAt,
  ...(o._count ? { item_count: o._count.items } : {}),
  ...(o.items
    ? { items: o.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, requested_quantity: i.requestedQuantity })) }
    : {}),
});
