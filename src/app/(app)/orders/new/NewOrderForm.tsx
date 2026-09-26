"use client";

import { useMemo, useState, useTransition } from "react";
import { createOrderAction } from "../../actions";

type P = { id: string; brand: string; stock: number; unitWeightKg: number; unitVolumeM3: number };
type Line = { key: number; productId: string; quantity: number };

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: "", quantity: 1 });

export default function NewOrderForm({ products }: { products: P[] }) {
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = lines.reduce(
    (t, l) => {
      const p = byId.get(l.productId);
      if (p) {
        t.weight += p.unitWeightKg * l.quantity;
        t.volume += p.unitVolumeM3 * l.quantity;
        t.units += l.quantity;
      }
      return t;
    },
    { weight: 0, volume: 0, units: 0 },
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const items = lines.filter((l) => l.productId).map((l) => ({ product_id: l.productId, quantity: l.quantity }));
    if (items.length === 0) return setError("Add at least one product.");
    startTransition(async () => {
      const res = await createOrderAction(items);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <datalist id="product-list">
        {products.map((p) => (
          <option key={p.id} value={p.id}>{`${p.brand} · stock ${p.stock}`}</option>
        ))}
      </datalist>

      {lines.map((l) => {
        const p = byId.get(l.productId);
        const over = p && l.quantity > p.stock;
        return (
          <div key={l.key} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Product</label>
              <input
                className="input mono"
                list="product-list"
                placeholder="e.g. C32_TECH_001"
                value={l.productId}
                onChange={(e) => update(l.key, { productId: e.target.value.toUpperCase().trim() })}
                required
              />
            </div>
            <div style={{ width: 110 }}>
              <label className="label">Quantity</label>
              <input
                className="input num"
                type="number"
                min={1}
                value={l.quantity}
                onChange={(e) => update(l.key, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              />
            </div>
            <div className="text-xs pb-2 w-40" style={{ color: over ? "var(--bad)" : "var(--muted)" }}>
              {l.productId && !p ? "Unknown product" : p ? `${p.brand} · ${p.stock} in stock` : ""}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm mb-1"
              onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
              disabled={lines.length === 1}
              aria-label="Remove line"
            >
              Remove
            </button>
          </div>
        );
      })}

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
        + Add line
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="muted text-sm">
          {totals.units} units · {totals.weight.toFixed(1)} kg · {totals.volume.toFixed(3)} m³
        </div>
        <button className="btn" disabled={pending}>{pending ? "Placing…" : "Place order"}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
