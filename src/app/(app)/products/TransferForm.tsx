"use client";

import { useActionState, useState } from "react";
import { WAREHOUSES } from "@/lib/warehouses";
import { transferStockAction } from "../actions";

/** Inline "move N units from one warehouse to the other" form for a product row. */
export default function TransferForm({ id, stock }: { id: string; stock: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string>(WAREHOUSES[0].code);
  const to = WAREHOUSES.find((w) => w.code !== from)!;
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof transferStockAction>>, form: FormData) => {
    const res = await transferStockAction(prev, form);
    if (!res?.error) setOpen(false);
    return res;
  }, undefined);

  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Transfer
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-1 justify-end">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to.code} />
      <select
        className="input"
        style={{ width: "auto", padding: ".2rem .4rem" }}
        name="from"
        aria-label="Transfer from"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      >
        {WAREHOUSES.map((w) => (
          <option key={w.code} value={w.code}>
            {w.name} ({stock[w.code] ?? 0})
          </option>
        ))}
      </select>
      <span className="muted text-xs">→ {to.name}</span>
      <input
        className="input num"
        style={{ width: 80, padding: ".2rem .4rem" }}
        name="quantity"
        type="number"
        min={1}
        defaultValue={1}
        aria-label="Transfer quantity"
        required
      />
      <button className="btn btn-sm" disabled={pending}>Move</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Cancel transfer">×</button>
      {state?.error && <span className="error whitespace-normal">{state.error}</span>}
    </form>
  );
}
