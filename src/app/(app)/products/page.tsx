import { listProducts, LOW_STOCK } from "@/lib/queries";
import { PageHeader, Pager, fmt } from "@/components/ui";
import StockEditor from "./StockEditor";

export const dynamic = "force-dynamic";

const BRANDS = ["Fresh", "Style", "Tech"];
const LIMIT = 25;

type SP = Promise<{ brand?: string; q?: string; sort?: string; page?: string }>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const brand = BRANDS.includes(sp.brand ?? "") ? sp.brand : undefined;
  const { total, items } = await listProducts({ brand, q: sp.q, sort: sp.sort, skip: (page - 1) * LIMIT, limit: LIMIT });

  return (
    <>
      <PageHeader title="Products" subtitle="Seeded from products.csv. Edit stock inline." />

      <form className="flex flex-wrap gap-2 mb-3" method="get">
        <input className="input" style={{ maxWidth: 240 }} name="q" placeholder="Search product ID" defaultValue={sp.q} />
        <select className="input" style={{ maxWidth: 160 }} name="brand" defaultValue={brand ?? ""}>
          <option value="">All brands</option>
          {BRANDS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 180 }} name="sort" defaultValue={sp.sort ?? ""}>
          <option value="">Sort by ID</option>
          <option value="stock">Sort by stock (low first)</option>
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Product ID</th>
              <th>Brand</th>
              <th className="num">Unit weight kg</th>
              <th className="num">Unit volume m³</th>
              <th>Basis</th>
              <th className="num">Stock</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>{p.brand}</td>
                <td className="num">{fmt(p.unitWeightKg, 2)}</td>
                <td className="num">{fmt(p.unitVolumeM3, 4)}</td>
                <td className="muted">{p.basis}</td>
                <td className="num">
                  <StockEditor id={p.id} stock={p.stock} low={p.stock < LOW_STOCK} />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No products match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} limit={LIMIT} total={total} basePath="/products" params={{ q: sp.q, brand, sort: sp.sort }} />
    </>
  );
}
