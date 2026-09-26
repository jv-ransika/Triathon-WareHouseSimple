"use client";

import { useActionState } from "react";
import { updateOrderStatusAction } from "../../actions";

const NEXT: Record<string, { status: string; label: string; danger?: boolean }[]> = {
  pending: [
    { status: "shipped", label: "Mark shipped" },
    { status: "cancelled", label: "Cancel order", danger: true },
  ],
  shipped: [{ status: "delivered", label: "Mark delivered" }],
};

export default function StatusForm({ code, status }: { code: string; status: string }) {
  const [state, action, pending] = useActionState(updateOrderStatusAction, undefined);
  const options = NEXT[status] ?? [];

  if (options.length === 0) return <p className="muted text-sm">No further status changes.</p>;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <div className="muted text-xs font-medium">Update status</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.status} name="status" value={o.status} disabled={pending} className={o.danger ? "btn btn-danger" : "btn"}>
            {o.label}
          </button>
        ))}
      </div>
      {status === "pending" && <p className="muted text-xs">Cancelling returns the units to stock.</p>}
      {state?.error && <p className="error">{state.error}</p>}
    </form>
  );
}
