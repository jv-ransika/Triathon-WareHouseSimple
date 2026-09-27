"use client";

import { useActionState, useState } from "react";
import { updateStockAction } from "../actions";

type Props = { id: string; warehouse: string; warehouseName: string; stock: number; reserved: number; low: boolean };

export default function StockEditor({ id, warehouse, warehouseName, stock, reserved, low }: Props) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateStockAction>>, form: FormData) => {
    const res = await updateStockAction(prev, form);
    if (!res?.error) setEditing(false);
    return res;
  }, undefined);

  if (!editing) {
    return (
      <span className="inline-flex flex-col items-end">
        <button
          className="num underline decoration-dotted underline-offset-4"
          style={low ? { color: "var(--bad)" } : undefined}
          onClick={() => setEditing(true)}
          title={`Edit ${warehouseName} stock`}
          aria-label={`Edit ${warehouseName} stock for ${id}`}
        >
          {stock.toLocaleString("en-US")}
        </button>
        {reserved > 0 && <span className="muted text-xs">{reserved.toLocaleString("en-US")} locked</span>}
      </span>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-1 justify-end">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="warehouse" value={warehouse} />
      <input
        className="input num"
        style={{ width: 90, padding: ".2rem .4rem" }}
        name="stock"
        type="number"
        min={0}
        defaultValue={stock}
        aria-label={`${warehouseName} stock`}
        autoFocus
      />
      <button className="btn btn-sm" disabled={pending}>Save</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} aria-label="Cancel edit">×</button>
      {state?.error && <span className="error">{state.error}</span>}
    </form>
  );
}
