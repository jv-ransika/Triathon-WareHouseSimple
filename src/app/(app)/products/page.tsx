import { releaseExpiredReservations } from "@/lib/orders";
import { listProducts, LOW_STOCK, parseTemp, stockByWarehouse, TEMPS } from "@/lib/queries";
import { getSelectedWarehouse } from "@/lib/warehouseScope";
import { WAREHOUSES, warehouseName } from "@/lib/warehouses";
import { PageHeader, Pager, TempBadge, fmt } from "@/components/ui";
import StockEditor from "./StockEditor";
import TransferForm from "./TransferForm";

export const dynamic = "force-dynamic";

const BRANDS = ["Fresh", "Style", "Tech"];
const LIMIT = 25;

type SP = Promise<{ brand?: string; temp?: string; q?: string; sort?: string; low?: string; page?: string }>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const wh = await getSelectedWarehouse();
  const page = Math.max(1, Number(sp.page) || 1);
  const brand = BRANDS.includes(sp.brand ?? "") ? sp.brand : undefined;
  const lowStock = sp.low === "1";
  const temp = parseTemp(sp.temp);
  await releaseExpiredReservations();
  const { total, items } = await listProducts({
    brand,
    temp,
    q: sp.q,
    sort: sp.sort,
    lowStock,
    warehouse: wh,
    skip: (page - 1) * LIMIT,
    limit: LIMIT,
  });
  const scope = wh ? warehouseName(wh) : "all warehouses";

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`Stock per warehouse. Click a number to edit it; "locked" units are held for orders awaiting confirmation. Sorting and low-stock use ${scope}.`}
      />

      <form className="flex flex-wrap items-center gap-2 mb-3" method="get">
        <input className="input" style={{ maxWidth: 240 }} name="q" placeholder="Search product ID" defaultValue={sp.q} />
        <select className="input" style={{ maxWidth: 160 }} name="brand" defaultValue={brand ?? ""}>
          <option value="">All brands</option>
          {BRANDS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 170 }} name="temp" defaultValue={temp ?? ""} aria-label="Temperature">
          <option value="">All temperatures</option>
          {TEMPS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 200 }} name="sort" defaultValue={sp.sort ?? ""}>
          <option value="">Sort by ID</option>
          <option value="stock">Sort by stock (low first)</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          <input type="checkbox" name="low" value="1" defaultChecked={lowStock} /> Low stock only
        </label>
        <button className="btn btn-ghost">Filter</button>
      </form>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Product ID</th>
              <th>Brand</th>
              <th>Temp</th>
              <th className="num">Unit kg</th>
              <th className="num">Unit m³</th>
              {WAREHOUSES.map((w) => (
                <th key={w.code} className="num" style={wh === w.code ? { color: "var(--text)" } : undefined}>
                  {w.name}
                </th>
              ))}
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const stock = stockByWarehouse(p.stocks);
              const totalAvail = Object.values(stock).reduce((s, x) => s + x.available, 0);
              return (
                <tr key={p.id} data-product={p.id}>
                  <td className="mono">{p.id}</td>
                  <td>{p.brand}</td>
                  <td><TempBadge temp={p.tempRequirement} /></td>
                  <td className="num">{fmt(p.unitWeightKg, 2)}</td>
                  <td className="num">{fmt(p.unitVolumeM3, 4)}</td>
                  {WAREHOUSES.map((w) => (
                    <td key={w.code} className="num" data-warehouse={w.code}>
                      <StockEditor
                        id={p.id}
                        warehouse={w.code}
                        warehouseName={w.name}
                        stock={stock[w.code].available}
                        reserved={stock[w.code].reserved}
                        low={stock[w.code].available < LOW_STOCK}
                      />
                    </td>
                  ))}
                  <td className="num">{fmt(totalAvail)}</td>
                  <td className="num">
                    <TransferForm id={p.id} stock={{ KDY: stock.KDY.available, PLG: stock.PLG.available }} />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">No products match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        page={page}
        limit={LIMIT}
        total={total}
        basePath="/products"
        params={{ q: sp.q, brand, temp: temp ?? undefined, sort: sp.sort, low: lowStock ? "1" : undefined }}
      />
    </>
  );
}
