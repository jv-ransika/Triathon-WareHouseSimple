import Link from "next/link";
import { ORDER_STATUSES, releaseExpiredReservations } from "@/lib/orders";
import { listOrders } from "@/lib/queries";
import { getSelectedWarehouse } from "@/lib/warehouseScope";
import { warehouseName } from "@/lib/warehouses";
import { PageHeader, Pager, StatusBadge, fmt, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const LIMIT = 25;
type SP = Promise<{ status?: string; q?: string; page?: string }>;

export default async function OrdersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const wh = await getSelectedWarehouse();
  await releaseExpiredReservations();
  const { total, items } = await listOrders({ status, q: sp.q, warehouse: wh, skip: (page - 1) * LIMIT, limit: LIMIT });

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={wh ? `${warehouseName(wh)} warehouse` : "All warehouses"}
        action={<Link className="btn" href="/orders/new">New order</Link>}
      />

      <form className="flex flex-wrap gap-2 mb-3" method="get">
        <input className="input" style={{ maxWidth: 240 }} name="q" placeholder="Search order ID" defaultValue={sp.q} />
        <select className="input" style={{ maxWidth: 160 }} name="status" defaultValue={status ?? ""}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s === "reserved" ? "awaiting confirmation" : s}</option>
          ))}
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Warehouse</th>
              <th>Status</th>
              <th>Source</th>
              <th className="num">Lines</th>
              <th className="num">Weight kg</th>
              <th className="num">Volume m³</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td><Link className="link mono" href={`/orders/${o.code}`}>{o.code}</Link></td>
                <td>{warehouseName(o.warehouseId)}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="muted">{o.source}</td>
                <td className="num">{o._count.items}</td>
                <td className="num">{fmt(o.totalWeightKg, 1)}</td>
                <td className="num">{fmt(o.totalVolumeM3, 3)}</td>
                <td className="muted">{fmtDate(o.createdAt)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No orders match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} limit={LIMIT} total={total} basePath="/orders" params={{ q: sp.q, status }} />
    </>
  );
}
