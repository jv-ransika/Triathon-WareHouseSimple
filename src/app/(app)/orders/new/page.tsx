import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import NewOrderForm from "./NewOrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    select: { id: true, brand: true, stock: true, unitWeightKg: true, unitVolumeM3: true },
  });

  return (
    <>
      <p className="mb-2"><Link className="link text-sm" href="/orders">← Orders</Link></p>
      <PageHeader title="New order" subtitle="Stock is reserved (decremented) when the order is placed." />
      <NewOrderForm products={products} />
    </>
  );
}
