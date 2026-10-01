import Link from "next/link";
import { prisma } from "@/lib/db";
import { releaseExpiredReservations } from "@/lib/orders";
import { stockByWarehouse } from "@/lib/queries";
import { getSelectedWarehouse } from "@/lib/warehouseScope";
import { WAREHOUSES } from "@/lib/warehouses";
import { PageHeader } from "@/components/ui";
import NewOrderForm from "./NewOrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  await releaseExpiredReservations();
  const [selected, products] = await Promise.all([
    getSelectedWarehouse(),
    prisma.product.findMany({ orderBy: { id: "asc" }, include: { stocks: true } }),
  ]);

  return (
    <>
      <p className="mb-2"><Link className="link text-sm" href="/orders">← Orders</Link></p>
      <PageHeader
        title="New order"
        subtitle="Stock is taken from the chosen warehouse. If it can't cover everything, what is available is locked until you confirm."
      />
      <NewOrderForm
        defaultWarehouse={selected ?? WAREHOUSES[0].code}
        products={products.map((p) => {
          const stock = stockByWarehouse(p.stocks);
          return {
            id: p.id,
            brand: p.brand,
            temp: p.tempRequirement,
            unitWeightKg: p.unitWeightKg,
            unitVolumeM3: p.unitVolumeM3,
            stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, v.available])),
          };
        })}
      />
    </>
  );
}
