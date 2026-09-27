import "server-only";
import { NextResponse } from "next/server";
import { authenticateApiKey } from "./apiKey";
import { AppError } from "./errors";
import { parseWarehouse, resolveWarehouse, type WarehouseCode } from "./warehouses";

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, auth: { userId: string; keyId: string }, params: P) => Promise<Response>;

/** Wraps a public API route: API-key auth + uniform error handling. */
export function withApiKey<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const auth = await authenticateApiKey(req);
      if (!auth) return apiError(401, "unauthorized", "Missing, invalid or revoked API key. Send it as 'x-api-key' header.");
      return await handler(req, auth, await ctx.params);
    } catch (e) {
      if (e instanceof AppError) return apiError(e.status, e.code, e.message, e.details);
      console.error(e);
      return apiError(500, "internal_error", "Unexpected server error");
    }
  };
}

export async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function pageParams(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

/** Optional ?warehouse= filter: null when absent, 422 when present but unknown. */
export function warehouseParam(url: URL): WarehouseCode | null {
  const raw = url.searchParams.get("warehouse");
  if (!raw) return null;
  return parseWarehouse(raw) ?? resolveWarehouse(raw);
}
