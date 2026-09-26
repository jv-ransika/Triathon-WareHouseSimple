import Link from "next/link";
import { prisma } from "@/lib/db";
import { LOW_STOCK } from "@/lib/queries";
import { PageHeader, StatusBadge, fmt, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

// createdAt may be ISO text (seed / adapter) or epoch ms; normalise to YYYY-MM.
const MONTH_SQL = `CASE WHEN typeof(createdAt) = 'integer'
  THEN strftime('%Y-%m', createdAt / 1000, 'unixepoch') ELSE substr(createdAt, 1, 7) END`;

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export default async function DashboardPage() {
  const [totals, byBrand, byMonth, byStatus, topProducts, lowStock, recent] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(`SELECT
      (SELECT COUNT(*) FROM "Product") AS products,
      (SELECT COALESCE(SUM(stock),0) FROM "Product") AS stock,
      (SELECT COUNT(*) FROM "Product" WHERE stock < ${LOW_STOCK}) AS lowStock,
      (SELECT COUNT(*) FROM "Order") AS orders,
      (SELECT COALESCE(SUM(quantity),0) FROM "OrderItem") AS units,
      (SELECT COALESCE(SUM(totalWeightKg),0) FROM "Order" WHERE status != 'cancelled') AS weight`),
    prisma.$queryRawUnsafe<Row[]>(`SELECT p.brand AS brand, SUM(oi.quantity) AS units, COUNT(DISTINCT oi.orderId) AS orders
      FROM "OrderItem" oi JOIN "Product" p ON p.id = oi.productId GROUP BY p.brand ORDER BY units DESC`),
    prisma.$queryRawUnsafe<Row[]>(`SELECT ${MONTH_SQL} AS month, COUNT(*) AS orders
      FROM "Order" GROUP BY month ORDER BY month DESC LIMIT 12`),
    prisma.$queryRawUnsafe<Row[]>(`SELECT status, COUNT(*) AS c FROM "Order" GROUP BY status`),
    prisma.$queryRawUnsafe<Row[]>(`SELECT productId, SUM(quantity) AS units FROM "OrderItem"
      GROUP BY productId ORDER BY units DESC LIMIT 5`),
    prisma.product.findMany({ where: { stock: { lt: LOW_STOCK } }, orderBy: { stock: "asc" }, take: 5 }),
    prisma.order.findMany({ orderBy: { id: "desc" }, take: 6, include: { _count: { select: { items: true } } } }),
  ]);

  const t = totals[0];
  const months = byMonth.map((r) => ({ month: String(r.month), orders: n(r.orders) })).reverse();
  const maxMonth = Math.max(1, ...months.map((m) => m.orders));
  const brands = byBrand.map((r) => ({ brand: String(r.brand), units: n(r.units), orders: n(r.orders) }));
  const maxBrand = Math.max(1, ...brands.map((b) => b.units));
  const maxTop = Math.max(1, ...topProducts.map((r) => n(r.units)));
  const statusCount = Object.fromEntries(byStatus.map((r) => [String(r.status), n(r.c)]));

  const stats = [
    { label: "Products", value: fmt(n(t.products)), sub: `${fmt(n(t.stock))} units in stock` },
    { label: "Orders", value: fmt(n(t.orders)), sub: `${fmt(statusCount.pending ?? 0)} pending` },
    { label: "Units ordered", value: fmt(n(t.units)), sub: `${fmt(n(t.weight) / 1000, 1)} t shipped weight` },
    { label: "Low stock", value: fmt(n(t.lowStock)), sub: `products below ${LOW_STOCK} units` },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Warehouse overview" action={<Link className="btn" href="/orders/new">New order</Link>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="muted text-xs font-medium">{s.label}</div>
            <div className="text-2xl font-semibold mt-1 num" style={{ textAlign: "left" }}>{s.value}</div>
            <div className="muted text-xs mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mb-4">
        <section className="card lg:col-span-2">
          <h2 className="font-medium">Orders per month</h2>
          <p className="muted text-xs mb-3">Last {months.length} months</p>
          <div className="chart-cols" role="img" aria-label="Orders per month column chart">
            {months.map((m) => (
              <div key={m.month} className="chart-col" tabIndex={0}>
                <span className="chart-tip">
                  {m.month}: {fmt(m.orders)} orders
                </span>
                <div className="chart-bar" style={{ height: `${(m.orders / maxMonth) * 100}%` }} />
                <span className="chart-x">{m.month.slice(2)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="font-medium">Units ordered by brand</h2>
          <p className="muted text-xs mb-3">All orders</p>
          <div className="space-y-3">
            {brands.map((b) => (
              <div key={b.brand} title={`${b.brand}: ${fmt(b.units)} units in ${fmt(b.orders)} orders`}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{b.brand}</span>
                  <span className="num">{fmt(b.units)}</span>
                </div>
                <div className="hbar-track">
                  <div className="hbar" style={{ width: `${(b.units / maxBrand) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <h2 className="font-medium mt-6">Top products</h2>
          <p className="muted text-xs mb-3">By units ordered</p>
          <div className="space-y-2">
            {topProducts.map((r) => (
              <div key={String(r.productId)}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="mono">{String(r.productId)}</span>
                  <span className="num">{fmt(n(r.units))}</span>
                </div>
                <div className="hbar-track">
                  <div className="hbar" style={{ width: `${(n(r.units) / maxTop) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <section className="card lg:col-span-2" style={{ padding: 0 }}>
          <div className="flex justify-between items-center p-4 pb-2">
            <h2 className="font-medium">Recent orders</h2>
            <Link className="link text-sm" href="/orders">View all</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Order</th><th>Status</th><th className="num">Lines</th><th className="num">Weight kg</th><th>Created</th></tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="link mono" href={`/orders/${o.code}`}>{o.code}</Link></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="num">{o._count.items}</td>
                    <td className="num">{fmt(o.totalWeightKg, 1)}</td>
                    <td className="muted">{fmtDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ padding: 0 }}>
          <div className="flex justify-between items-center p-4 pb-2">
            <h2 className="font-medium">Low stock</h2>
            <Link className="link text-sm" href="/products?sort=stock">Manage</Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="muted text-sm px-4 pb-4">All products have at least {LOW_STOCK} units.</p>
          ) : (
            <table className="table">
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td className="num" style={{ color: "var(--bad)" }}>{fmt(p.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
