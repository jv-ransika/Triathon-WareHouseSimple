"use client";

import { useActionState, useState } from "react";
import { updateStockAction } from "../actions";

export default function StockEditor({ id, stock, low }: { id: string; stock: number; low: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateStockAction>>, form: FormData) => {
    const res = await updateStockAction(prev, form);
    if (!res?.error) setEditing(false);
    return res;
  }, undefined);

  if (!editing) {
    return (
      <button
        className="num underline decoration-dotted underline-offset-4"
        style={low ? { color: "var(--bad)" } : undefined}
        onClick={() => setEditing(true)}
        title="Click to edit stock"
      >
        {stock.toLocaleString()}
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-1 justify-end">
      <input type="hidden" name="id" value={id} />
      <input className="input num" style={{ width: 90, padding: ".2rem .4rem" }} name="stock" type="number" min={0} defaultValue={stock} autoFocus />
      <button className="btn btn-sm" disabled={pending}>Save</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>×</button>
      {state?.error && <span className="error">{state.error}</span>}
    </form>
  );
}
