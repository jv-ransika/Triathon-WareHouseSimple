import "server-only";
import { prisma } from "./db";

export const USAGE_RETENTION_DAYS = 30;
export const USAGE_RANGES = { "24h": 1, "7d": 7, "30d": 30 } as const;
export type UsageRange = keyof typeof USAGE_RANGES;

export function parseRange(v: unknown): UsageRange {
  return typeof v === "string" && v in USAGE_RANGES ? (v as UsageRange) : "7d";
}

/**
 * Record one API request. Awaited by the caller (serverless platforms may drop work
 * left pending after the response), but never throws: monitoring must not break the API.
 */
export async function logApiRequest(entry: {
  apiKeyId: string | null;
  userId: string | null;
  method: string;
  route: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
}) {
  try {
    await prisma.apiRequest.create({ data: entry });
    // Occasionally prune rows past the retention window instead of running a cron.
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - USAGE_RETENTION_DAYS * 86_400_000);
      await prisma.apiRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
    }
  } catch (e) {
    console.error("usage log failed", e);
  }
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

// createdAt may be ISO text or epoch ms; normalise to YYYY-MM-DD / YYYY-MM-DDTHH.
const DAY_SQL = `CASE WHEN typeof(createdAt) = 'integer' THEN strftime('%Y-%m-%d', createdAt / 1000, 'unixepoch') ELSE substr(createdAt, 1, 10) END`;
const HOUR_SQL = `CASE WHEN typeof(createdAt) = 'integer' THEN strftime('%Y-%m-%dT%H', createdAt / 1000, 'unixepoch') ELSE substr(createdAt, 1, 13) END`;

/** Usage of one user's API keys over the last `days` days. */
export async function getUsage(userId: string, range: UsageRange, opts: { recent?: number } = {}) {
  const days = USAGE_RANGES[range];
  const since = new Date(Date.now() - days * 86_400_000);
  const where = `userId = ? AND createdAt >= ?`;
  const args = [userId, since.toISOString()];
  const bucket = days === 1 ? HOUR_SQL : DAY_SQL;
  const q = (sql: string) => prisma.$queryRawUnsafe<Row[]>(sql, ...args);

  const [totals, series, byRoute, byKey, byStatus, recent] = await Promise.all([
    q(`SELECT COUNT(*) AS total,
         SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN status = 401 THEN 1 ELSE 0 END) AS unauthorized,
         AVG(durationMs) AS avgMs, MAX(durationMs) AS maxMs
       FROM "ApiRequest" WHERE ${where}`),
    q(`SELECT ${bucket} AS bucket, COUNT(*) AS total, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
       FROM "ApiRequest" WHERE ${where} GROUP BY bucket ORDER BY bucket`),
    q(`SELECT method, route, COUNT(*) AS total, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
         AVG(durationMs) AS avgMs, MAX(durationMs) AS maxMs
       FROM "ApiRequest" WHERE ${where} GROUP BY method, route ORDER BY total DESC`),
    q(`SELECT r.apiKeyId AS keyId, k.name AS name, k.prefix AS prefix, k.revokedAt AS revokedAt,
         COUNT(*) AS total, SUM(CASE WHEN r.status >= 400 THEN 1 ELSE 0 END) AS errors, MAX(r.createdAt) AS lastAt
       FROM "ApiRequest" r LEFT JOIN "ApiKey" k ON k.id = r.apiKeyId
       WHERE r.userId = ? AND r.createdAt >= ? GROUP BY r.apiKeyId ORDER BY total DESC`),
    q(`SELECT status, COUNT(*) AS total FROM "ApiRequest" WHERE ${where} GROUP BY status ORDER BY status`),
    prisma.apiRequest.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { id: "desc" },
      take: opts.recent ?? 50,
      include: { apiKey: { select: { name: true, prefix: true } } },
    }),
  ]);

  const t = totals[0] ?? {};
  const total = n(t.total);

  // Fill empty buckets so the chart has a bar per hour/day.
  const counts = new Map(series.map((r) => [String(r.bucket), { total: n(r.total), errors: n(r.errors) }]));
  const buckets: { bucket: string; total: number; errors: number }[] = [];
  const steps = days === 1 ? 24 : days;
  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * (days === 1 ? 3_600_000 : 86_400_000));
    const key = days === 1 ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
    buckets.push({ bucket: key, ...(counts.get(key) ?? { total: 0, errors: 0 }) });
  }

  return {
    range,
    since,
    total,
    errors: n(t.errors),
    unauthorized: n(t.unauthorized),
    errorRate: total ? n(t.errors) / total : 0,
    avgMs: Math.round(n(t.avgMs)),
    maxMs: n(t.maxMs),
    series: buckets,
    byRoute: byRoute.map((r) => ({
      method: String(r.method),
      route: String(r.route),
      total: n(r.total),
      errors: n(r.errors),
      avgMs: Math.round(n(r.avgMs)),
      maxMs: n(r.maxMs),
    })),
    byKey: byKey.map((r) => ({
      keyId: (r.keyId as string | null) ?? null,
      name: (r.name as string | null) ?? "Deleted key",
      prefix: (r.prefix as string | null) ?? null,
      revoked: !!r.revokedAt,
      total: n(r.total),
      errors: n(r.errors),
      lastAt: r.lastAt ? new Date(String(r.lastAt)) : null,
    })),
    byStatus: byStatus.map((r) => ({ status: n(r.status), total: n(r.total) })),
    recent,
  };
}

/** Request counts per key for the API keys page. */
export async function requestCountsByKey(userId: string, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.apiRequest.groupBy({
    by: ["apiKeyId"],
    where: { userId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.apiKeyId, r._count._all]));
}
