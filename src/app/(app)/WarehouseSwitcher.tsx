"use client";

import { useRef } from "react";
import { WAREHOUSES } from "@/lib/warehouses";
import { setWarehouseAction } from "./actions";

export default function WarehouseSwitcher({ selected }: { selected: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setWarehouseAction} className="md:px-2 md:mb-2">
      <label className="label hidden md:block" htmlFor="warehouse-switcher">Warehouse</label>
      <select
        id="warehouse-switcher"
        name="warehouse"
        aria-label="Warehouse"
        className="input"
        style={{ padding: ".3rem .5rem" }}
        defaultValue={selected ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">All warehouses</option>
        {WAREHOUSES.map((w) => (
          <option key={w.code} value={w.code}>{w.name}</option>
        ))}
      </select>
    </form>
  );
}
