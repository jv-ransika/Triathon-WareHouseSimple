import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { lookupApiKey } from "./apiKey";
import { AppError } from "./errors";
import { logApiRequest } from "./usage";
import { parseWarehouse, resolveWarehouse, type WarehouseCode } from "./warehouses";

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, auth: { userId: string; keyId: string }, params: P) => Promise<Response>;

/** /api/v1/orders/ORD0000001 + { id: "ORD0000001" } -> /api/v1/orders/:id */
function routePattern(pathname: string, params: Record<string, unknown>) {
  const entries = Object.entries(params ?? {});
  return pathname
    .split("/")
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {}
      const hit = entries.find(([, v]) => v === decoded);
      return hit ? `:${hit[0]}` : seg;
    })
    .join("/");
}

/**
 * Wraps a public API route: API-key auth, uniform error handling, and a usage log
 * row per request (rejected ones included) for the API usage page.
 */
export function withApiKey<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: Ctx<P>) => {
    const started = Date.now();
    const params = (await ctx.params) as P;
    let key: Awaited<ReturnType<typeof lookupApiKey>> = null;
    let res: Response;
    try {
      key = await lookupApiKey(req);
      if (!key || key.revokedAt) {
        res = apiError(401, "unauthorized", "Missing, invalid or revoked API key. Send it as 'x-api-key' header.");
      } else {
        // Awaited: serverless platforms may drop work still pending after the response is sent.
        await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
        res = await handler(req, { userId: key.userId, keyId: key.id }, params);
      }
    } catch (e) {
      if (e instanceof AppError) res = apiError(e.status, e.code, e.message, e.details);
      else {
        console.error(e);
        res = apiError(500, "internal_error", "Unexpected server error");
      }
    }
    const url = new URL(req.url);
    await logApiRequest({
      apiKeyId: key?.id ?? null,
      userId: key?.userId ?? null, // revoked keys are still attributed to their owner
      method: req.method,
      route: routePattern(url.pathname, params as Record<string, unknown>),
      path: url.pathname + url.search,
      status: res.status,
      durationMs: Date.now() - started,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    });
    return res;
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
