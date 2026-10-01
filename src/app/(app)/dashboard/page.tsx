import Link from "next/link";
import { prisma } from "@/lib/db";
import { releaseExpiredReservations } from "@/lib/orders";
import { LOW_STOCK } from "@/lib/queries";
import { getSelectedWarehouse } from "@/lib/warehouseScope";
import { warehouseName } from "@/lib/warehouses";
import { PageHeader, StatusBadge, TempBadge, fmt, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

// createdAt may be ISO text (seed / adapter) or epoch ms; normalise to YYYY-MM.
const MONTH_SQL = `CASE WHEN typeof(o.createdAt) = 'integer'
  THEN strftime('%Y-%m', o.createdAt / 1000, 'unixepoch') ELSE substr(o.createdAt, 1, 7) END`;

// Units that actually left (or will leave) the warehouse.
const LIVE = `o.status NOT IN ('cancelled', 'expired')`;

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export default async function DashboardPage() {
  const wh = await getSelectedWarehouse();
  await releaseExpiredReservations();

  // Optional warehouse filter appended to every query.
  const oWhere = wh ? `AND o.warehouseId = ?` : "";
  const sWhere = wh ? `AND s.warehouseId = ?` : "";
  const a = wh ? [wh] : [];
  const q = <T = Row,>(sql: string, args: unknown[] = a) => prisma.$queryRawUnsafe<T[]>(sql, ...args);

  const [totals, byBrand, byMonth, byStatus, topProducts, lowStock, recent, byWarehouse, byTemp] = await Promise.all([
    q(
      `SELECT
        (SELECT COUNT(*) FROM "Product") AS products,
        (SELECT COALESCE(SUM(quantity),0) FROM "Stock" s WHERE 1=1 ${sWhere}) AS available,
        (SELECT COALESCE(SUM(reserved),0) FROM "Stock" s WHERE 1=1 ${sWhere}) AS reserved,
        (SELECT COUNT(*) FROM "Stock" s WHERE quantity < ${LOW_STOCK} ${sWhere}) AS lowStock,
        (SELECT COUNT(*) FROM "Order" o WHERE 1=1 ${oWhere}) AS orders,
        (SELECT COALESCE(SUM(oi.quantity),0) FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId WHERE ${LIVE} ${oWhere}) AS units,
        (SELECT COALESCE(SUM(totalWeightKg),0) FROM "Order" o WHERE ${LIVE} ${oWhere}) AS weight`,
      [...a, ...a, ...a, ...a, ...a, ...a],
    ),
    q(`SELECT p.brand AS brand, SUM(oi.quantity) AS units, COUNT(DISTINCT oi.orderId) AS orders
       FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId JOIN "Product" p ON p.id = oi.productId
       WHERE ${LIVE} ${oWhere} GROUP BY p.brand ORDER BY units DESC`),
    q(`SELECT ${MONTH_SQL} AS month, COUNT(*) AS orders FROM "Order" o WHERE 1=1 ${oWhere}
       GROUP BY month ORDER BY month DESC LIMIT 12`),
    q(`SELECT o.status AS status, COUNT(*) AS c FROM "Order" o WHERE 1=1 ${oWhere} GROUP BY o.status`),
    q(`SELECT oi.productId AS productId, SUM(oi.quantity) AS units FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId
       WHERE ${LIVE} ${oWhere} GROUP BY oi.productId ORDER BY units DESC LIMIT 5`),
    prisma.stock.findMany({
      where: { quantity: { lt: LOW_STOCK }, ...(wh ? { warehouseId: wh } : {}) },
      orderBy: [{ quantity: "asc" }, { productId: "asc" }],
      take: 6,
    }),
    prisma.order.findMany({
      where: wh ? { warehouseId: wh } : {},
      orderBy: { id: "desc" },
      take: 6,
      include: { _count: { select: { items: true } } },
    }),
    wh
      ? Promise.resolve([] as Row[])
      : q(
          `SELECT w.id AS code,
             (SELECT COUNT(*) FROM "Order" o WHERE o.warehouseId = w.id) AS orders,
             (SELECT COALESCE(SUM(quantity),0) FROM "Stock" s WHERE s.warehouseId = w.id) AS available,
             (SELECT COALESCE(SUM(reserved),0) FROM "Stock" s WHERE s.warehouseId = w.id) AS reserved
           FROM "Warehouse" w ORDER BY w.id`,
          [],
        ),
    // Per temperature: orders and units ordered, plus units available in stock.
    q(
      `SELECT t.temp AS temp,
         (SELECT COUNT(*) FROM "Order" o WHERE o.tempRequirement = t.temp ${oWhere}) AS orders,
         (SELECT COALESCE(SUM(oi.quantity),0) FROM "OrderItem" oi JOIN "Order" o ON o.id = oi.orderId
            JOIN "Product" p ON p.id = oi.productId WHERE p.tempRequirement = t.temp AND ${LIVE} ${oWhere}) AS units,
         (SELECT COALESCE(SUM(s.quantity),0) FROM "Stock" s JOIN "Product" p ON p.id = s.productId
            WHERE p.tempRequirement = t.temp ${sWhere}) AS available
       FROM (SELECT 'ambient' AS temp UNION ALL SELECT 'chilled') t`,
      [...a, ...a, ...a],
    ),
  ]);

  const t = totals[0];
  const months = byMonth.map((r) => ({ month: String(r.month), orders: n(r.orders) })).reverse();
  const maxMonth = Math.max(1, ...months.map((m) => m.orders));
  const brands = byBrand.map((r) => ({ brand: String(r.brand), units: n(r.units), orders: n(r.orders) }));
  const maxBrand = Math.max(1, ...brands.map((b) => b.units));
  const maxTop = Math.max(1, ...topProducts.map((r) => n(r.units)));
  const temps = byTemp.map((r) => ({ temp: String(r.temp), orders: n(r.orders), units: n(r.units), available: n(r.available) }));
  const maxTempUnits = Math.max(1, ...temps.map((x) => x.units));
  const statusCount = Object.fromEntries(byStatus.map((r) => [String(r.status), n(r.c)]));
  const scope = wh ? warehouseName(wh) : "All warehouses";

  const stats = [
    { label: "Units available", value: fmt(n(t.available)), sub: `${fmt(n(t.reserved))} locked · ${fmt(n(t.products))} products` },
    { label: "Orders", value: fmt(n(t.orders)), sub: `${fmt(statusCount.pending ?? 0)} pending` },
    {
      label: "Awaiting confirmation",
      value: fmt(statusCount.reserved ?? 0),
      sub: "partially available orders with locked stock",
    },
    { label: "Units ordered", value: fmt(n(t.units)), sub: `${fmt(n(t.weight) / 1000, 1)} t total weight` },
    { label: "Low stock", value: fmt(n(t.lowStock)), sub: `stock rows below ${LOW_STOCK} units` },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${scope} overview`}
        action={<Link className="btn" href="/orders/new">New order</Link>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="muted text-xs font-medium">{s.label}</div>
            <div className="text-2xl font-semibold mt-1 num" style={{ textAlign: "left" }}>{s.value}</div>
            <div className="muted text-xs mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {byWarehouse.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          {byWarehouse.map((w) => (
            <div key={String(w.code)} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{warehouseName(String(w.code))}</div>
                <div className="muted text-xs">{String(w.code)}</div>
              </div>
              <div className="flex gap-6 text-sm">
                <div><div className="muted text-xs">Orders</div><div className="num" style={{ textAlign: "left" }}>{fmt(n(w.orders))}</div></div>
                <div><div className="muted text-xs">Available</div><div className="num" style={{ textAlign: "left" }}>{fmt(n(w.available))}</div></div>
                <div><div className="muted text-xs">Locked</div><div className="num" style={{ textAlign: "left" }}>{fmt(n(w.reserved))}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-3 mb-4">
        <section className="card lg:col-span-2">
          <h2 className="font-medium">Orders per month</h2>
          <p className="muted text-xs mb-3">{scope} · last {months.length} months</p>
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
          <p className="muted text-xs mb-3">{scope}</p>
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
          <h2 className="font-medium mt-6">By temperature</h2>
          <p className="muted text-xs mb-3">Units ordered · orders · units in stock</p>
          <div className="space-y-3" data-testid="dashboard-by-temp">
            {temps.map((x) => (
              <div key={x.temp} title={`${x.temp}: ${fmt(x.units)} units in ${fmt(x.orders)} orders, ${fmt(x.available)} in stock`}>
                <div className="flex justify-between text-sm mb-1">
                  <TempBadge temp={x.temp} />
                  <span className="num">
                    {fmt(x.units)} <span className="muted">· {fmt(x.orders)} orders · {fmt(x.available)} in stock</span>
                  </span>
                </div>
                <div className="hbar-track">
                  <div className="hbar" style={{ width: `${(x.units / maxTempUnits) * 100}%` }} />
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
                <tr><th>Order</th><th>Warehouse</th><th>Temp</th><th>Status</th><th className="num">Lines</th><th className="num">Weight kg</th><th>Created</th></tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="link mono" href={`/orders/${o.code}`}>{o.code}</Link></td>
                    <td>{warehouseName(o.warehouseId)}</td>
                    <td><TempBadge temp={o.tempRequirement} /></td>
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
            <p className="muted text-sm px-4 pb-4">All products have at least {LOW_STOCK} units{wh ? ` in ${scope}` : " in each warehouse"}.</p>
          ) : (
            <table className="table">
              <tbody>
                {lowStock.map((s) => (
                  <tr key={s.warehouseId + s.productId}>
                    <td className="mono">{s.productId}</td>
                    <td className="muted">{warehouseName(s.warehouseId)}</td>
                    <td className="num" style={{ color: "var(--bad)" }}>{fmt(s.quantity)}</td>
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
