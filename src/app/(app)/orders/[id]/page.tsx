import Link from "next/link";
import { notFound } from "next/navigation";
import { getShortfall, releaseExpiredReservations } from "@/lib/orders";
import { getOrder } from "@/lib/queries";
import { warehouseName } from "@/lib/warehouses";
import { PageHeader, StatusBadge, fmt, fmtDate } from "@/components/ui";
import ReservationPanel from "./ReservationPanel";
import StatusForm from "./StatusForm";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await releaseExpiredReservations();
  const order = await getOrder(decodeURIComponent(id).toUpperCase());
  if (!order) notFound();

  const warehouse = warehouseName(order.warehouseId);
  const units = order.items.reduce((s, i) => s + i.quantity, 0);
  const requested = order.items.reduce((s, i) => s + i.requestedQuantity, 0);
  const shortfall = order.status === "reserved" ? await getShortfall(order) : [];
  const hasShort = order.items.some((i) => i.quantity < i.requestedQuantity);

  return (
    <>
      <p className="mb-2"><Link className="link text-sm" href="/orders">← Orders</Link></p>
      <PageHeader title={order.code} subtitle={`${warehouse} warehouse`} action={<StatusBadge status={order.status} />} />

      {order.status === "reserved" && order.expiresAt && (
        <ReservationPanel
          code={order.code}
          warehouse={warehouse}
          expiresAt={order.expiresAt.toISOString()}
          lockedUnits={units}
          requestedUnits={requested}
          shortfall={shortfall}
        />
      )}
      {order.status === "expired" && (
        <div className="card mb-4" style={{ borderColor: "var(--bad)" }}>
          <p className="font-medium">Reservation expired</p>
          <p className="muted text-sm">It was not confirmed in time, so the locked units went back to {warehouse} stock.</p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          [order.status === "reserved" ? "Units locked" : "Units", `${fmt(units)}${hasShort ? ` of ${fmt(requested)}` : ""}`],
          ["Total weight", `${fmt(order.totalWeightKg, 1)} kg`],
          ["Total volume", `${fmt(order.totalVolumeM3, 3)} m³`],
          ["Created", fmtDate(order.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className="muted text-xs font-medium">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <section className="card table-wrap lg:col-span-2" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Brand</th>
                <th className="num">Requested</th>
                <th className="num">{order.status === "reserved" ? "Locked" : "Qty"}</th>
                <th className="num">Weight kg</th>
                <th className="num">Volume m³</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.productId}</td>
                  <td>{i.product.brand}</td>
                  <td className="num">{fmt(i.requestedQuantity)}</td>
                  <td className="num" style={i.quantity < i.requestedQuantity ? { color: "var(--warn)" } : undefined}>
                    {fmt(i.quantity)}
                  </td>
                  <td className="num">{fmt(i.product.unitWeightKg * i.quantity, 1)}</td>
                  <td className="num">{fmt(i.product.unitVolumeM3 * i.quantity, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card space-y-3">
          <div>
            <div className="muted text-xs font-medium">Warehouse</div>
            <div>{warehouse} ({order.warehouseId})</div>
          </div>
          <div>
            <div className="muted text-xs font-medium">Source</div>
            <div>{order.source}{order.createdBy ? ` · ${order.createdBy.email}` : ""}</div>
          </div>
          {order.status !== "reserved" && <StatusForm code={order.code} status={order.status} warehouse={warehouse} />}
        </section>
      </div>
    </>
  );
}
