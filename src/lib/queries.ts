import "server-only";
import type { Prisma, Product, Order, OrderItem } from "@prisma/client";
import { prisma } from "./db";

export const LOW_STOCK = 50;

export async function listProducts(opts: {
  brand?: string | null;
  q?: string | null;
  sort?: string | null;
  skip: number;
  limit: number;
}) {
  const where: Prisma.ProductWhereInput = {};
  if (opts.brand) where.brand = opts.brand;
  if (opts.q) where.id = { contains: opts.q.toUpperCase() };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    opts.sort === "stock" ? [{ stock: "asc" }, { id: "asc" }] : [{ id: "asc" }];
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, skip: opts.skip, take: opts.limit }),
  ]);
  return { total, items };
}

export async function listOrders(opts: { status?: string | null; q?: string | null; skip: number; limit: number }) {
  const where: Prisma.OrderWhereInput = {};
  if (opts.status) where.status = opts.status;
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

export const productJson = (p: Product) => ({
  product_id: p.id,
  brand: p.brand,
  unit_weight_kg: p.unitWeightKg,
  unit_volume_m3: p.unitVolumeM3,
  basis: p.basis,
  verified_real_sku: p.verifiedRealSku,
  stock: p.stock,
  updated_at: p.updatedAt,
});

export const orderJson = (o: Order & { items?: OrderItem[]; _count?: { items: number } }) => ({
  order_id: o.code,
  status: o.status,
  source: o.source,
  total_weight_kg: Number(o.totalWeightKg.toFixed(3)),
  total_volume_m3: Number(o.totalVolumeM3.toFixed(4)),
  created_at: o.createdAt,
  ...(o._count ? { item_count: o._count.items } : {}),
  ...(o.items ? { items: o.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })) } : {}),
});
