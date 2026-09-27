import { NextResponse } from "next/server";
import { withApiKey } from "@/lib/api";
import { getUsage, parseRange } from "@/lib/usage";

// Usage of all API keys owned by the calling key's user. ?range=24h|7d|30d (default 7d).
export const GET = withApiKey(async (req, auth) => {
  const u = await getUsage(auth.userId, parseRange(new URL(req.url).searchParams.get("range")), { recent: 20 });
  return NextResponse.json({
    data: {
      range: u.range,
      since: u.since,
      total_requests: u.total,
      errors: u.errors,
      unauthorized: u.unauthorized,
      error_rate: Number(u.errorRate.toFixed(4)),
      avg_ms: u.avgMs,
      max_ms: u.maxMs,
      series: u.series,
      by_endpoint: u.byRoute.map((r) => ({ endpoint: `${r.method} ${r.route}`, requests: r.total, errors: r.errors, avg_ms: r.avgMs, max_ms: r.maxMs })),
      by_key: u.byKey.map((k) => ({ name: k.name, prefix: k.prefix, revoked: k.revoked, requests: k.total, errors: k.errors, last_request_at: k.lastAt })),
      by_status: u.byStatus,
      recent: u.recent.map((r) => ({
        at: r.createdAt,
        method: r.method,
        path: r.path,
        status: r.status,
        duration_ms: r.durationMs,
        key: r.apiKey ? `${r.apiKey.name} (${r.apiKey.prefix}…)` : null,
      })),
    },
  });
});
