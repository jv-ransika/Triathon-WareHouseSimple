import "server-only";
import { cookies } from "next/headers";
import { parseWarehouse, type WarehouseCode } from "./warehouses";

export const WAREHOUSE_COOKIE = "wh_warehouse";

/** Warehouse picked in the sidebar switcher, or null for "All warehouses". */
export async function getSelectedWarehouse(): Promise<WarehouseCode | null> {
  return parseWarehouse((await cookies()).get(WAREHOUSE_COOKIE)?.value);
}
