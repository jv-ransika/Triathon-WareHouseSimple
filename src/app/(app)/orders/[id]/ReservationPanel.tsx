"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Shortfall } from "@/lib/orders";
import { confirmOrderAction, updateOrderStatusAction } from "../../actions";

type Props = {
  code: string;
  warehouse: string;
  expiresAt: string;
  lockedUnits: number;
  requestedUnits: number;
  shortfall: Shortfall[];
};

function useCountdown(until: string) {
  const [left, setLeft] = useState(() => new Date(until).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, left);
}

/** Shown on a "reserved" order: stock is locked until the user confirms the partial order or cancels. */
export default function ReservationPanel({ code, warehouse, expiresAt, lockedUnits, requestedUnits, shortfall }: Props) {
  const router = useRouter();
  const left = useCountdown(expiresAt);
  const [confirmState, confirm, confirming] = useActionState(confirmOrderAction, undefined);
  const [cancelState, cancel, cancelling] = useActionState(updateOrderStatusAction, undefined);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  // When the lock runs out, reload so the server marks the order expired.
  useEffect(() => {
    if (left === 0) router.refresh();
  }, [left, router]);

  return (
    <div className="card mb-4 space-y-3" style={{ borderColor: "var(--warn)" }} data-testid="reservation-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Not enough stock in {warehouse}. Awaiting your confirmation.</p>
          <p className="muted text-sm">
            {lockedUnits.toLocaleString("en-US")} of {requestedUnits.toLocaleString("en-US")} units are locked for this order. No one
            else can take them until you confirm or cancel.
          </p>
        </div>
        <div className="text-right">
          <div className="muted text-xs">Lock expires in</div>
          <div className="text-xl font-semibold num" data-testid="countdown">{mm}:{ss}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Requested</th>
              <th className="num">Locked</th>
              <th className="num">Short</th>
              <th>Other warehouse</th>
            </tr>
          </thead>
          <tbody>
            {shortfall.map((s) => (
              <tr key={s.product_id}>
                <td className="mono">{s.product_id}</td>
                <td className="num">{s.requested.toLocaleString("en-US")}</td>
                <td className="num">{s.reserved.toLocaleString("en-US")}</td>
                <td className="num" style={{ color: "var(--bad)" }}>{s.shortfall.toLocaleString("en-US")}</td>
                <td className="muted">
                  {s.other_warehouse.name} has {s.other_warehouse.available.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={confirm}>
          <input type="hidden" name="code" value={code} />
          <button className="btn" disabled={confirming || cancelling || left === 0}>
            Confirm partial order ({lockedUnits.toLocaleString("en-US")} units)
          </button>
        </form>
        <form action={cancel}>
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="status" value="cancelled" />
          <button className="btn btn-danger" disabled={confirming || cancelling}>
            Cancel and release stock
          </button>
        </form>
      </div>
      <p className="muted text-xs">
        Tip: to get the missing units, transfer them from the other warehouse on the Products page, then place a new order.
      </p>
      {(confirmState?.error || cancelState?.error) && <p className="error">{confirmState?.error ?? cancelState?.error}</p>}
    </div>
  );
}
