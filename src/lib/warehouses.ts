// Shared by server and client code (no server-only imports here).
import { AppError } from "./errors";

export const WAREHOUSES = [
  { code: "KDY", name: "Kandy" },
  { code: "PLG", name: "Peliyagoda" },
] as const;

export type WarehouseCode = (typeof WAREHOUSES)[number]["code"];

export const warehouseName = (code: string) => WAREHOUSES.find((w) => w.code === code)?.name ?? code;

export const otherWarehouse = (code: WarehouseCode): WarehouseCode => (code === "KDY" ? "PLG" : "KDY");

/** Accepts a code ("KDY") or name ("kandy"), case-insensitive. Returns null if not a warehouse. */
export function parseWarehouse(input: unknown): WarehouseCode | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return WAREHOUSES.find((w) => w.code.toLowerCase() === v || w.name.toLowerCase() === v)?.code ?? null;
}

/** Like parseWarehouse but throws a 422 for missing/unknown values. */
export function resolveWarehouse(input: unknown, field = "warehouse"): WarehouseCode {
  const code = parseWarehouse(input);
  if (!code) {
    throw new AppError(422, "validation_error", `${field} must be one of: ${WAREHOUSES.map((w) => `${w.code} (${w.name})`).join(", ")}`);
  }
  return code;
}
