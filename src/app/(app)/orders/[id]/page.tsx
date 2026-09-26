import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/queries";
import { PageHeader, StatusBadge, fmt, fmtDate } from "@/components/ui";
import StatusForm from "./StatusForm";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(decodeURIComponent(id).toUpperCase());
  if (!order) notFound();

  const units = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <p className="mb-2"><Link className="link text-sm" href="/orders">← Orders</Link></p>
      <PageHeader title={order.code} action={<StatusBadge status={order.status} />} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          ["Units", fmt(units)],
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
                <th className="num">Qty</th>
                <th className="num">Weight kg</th>
                <th className="num">Volume m³</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.productId}</td>
                  <td>{i.product.brand}</td>
                  <td className="num">{fmt(i.quantity)}</td>
                  <td className="num">{fmt(i.product.unitWeightKg * i.quantity, 1)}</td>
                  <td className="num">{fmt(i.product.unitVolumeM3 * i.quantity, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card space-y-3">
          <div>
            <div className="muted text-xs font-medium">Source</div>
            <div>{order.source}{order.createdBy ? ` · ${order.createdBy.email}` : ""}</div>
          </div>
          <StatusForm code={order.code} status={order.status} />
        </section>
      </div>
    </>
  );
}
