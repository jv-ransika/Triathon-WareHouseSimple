import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getUsage, parseRange, USAGE_RANGES, USAGE_RETENTION_DAYS } from "@/lib/usage";
import { PageHeader, fmt, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<string, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };

function StatusCode({ status }: { status: number }) {
  const color = status >= 500 ? "var(--bad)" : status >= 400 ? "var(--warn)" : "var(--good)";
  return (
    <span className="badge mono">
      <span className="dot" style={{ background: color }} />
      {status}
    </span>
  );
}

export default async function ApiUsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const range = parseRange((await searchParams).range);
  const u = await getUsage(user.id, range);
  const hourly = range === "24h";
  const max = Math.max(1, ...u.series.map((s) => s.total));

  const stats = [
    { label: "Requests", value: fmt(u.total), sub: RANGE_LABEL[range].toLowerCase() },
    {
      label: "Error rate",
      value: `${(u.errorRate * 100).toFixed(1)}%`,
      sub: `${fmt(u.errors)} responses with status 4xx/5xx`,
    },
    { label: "Rejected (401)", value: fmt(u.unauthorized), sub: "revoked keys used" },
    { label: "Avg response", value: `${fmt(u.avgMs)} ms`, sub: `slowest ${fmt(u.maxMs)} ms` },
  ];

  return (
    <>
      <PageHeader
        title="API usage"
        subtitle={`Requests made with your API keys. Logs are kept for ${USAGE_RETENTION_DAYS} days.`}
        action={
          <div className="flex gap-1" role="group" aria-label="Time range">
            {Object.keys(USAGE_RANGES).map((r) => (
              <Link
                key={r}
                href={`/api-usage?range=${r}`}
                className={r === range ? "btn btn-sm" : "btn btn-ghost btn-sm"}
                aria-current={r === range ? "true" : undefined}
              >
                {r}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="muted text-xs font-medium">{s.label}</div>
            <div className="text-2xl font-semibold mt-1 num" style={{ textAlign: "left" }} data-stat={s.label}>{s.value}</div>
            <div className="muted text-xs mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <section className="card mb-4">
        <h2 className="font-medium">Requests per {hourly ? "hour" : "day"}</h2>
        <p className="muted text-xs mb-3">{RANGE_LABEL[range]} · hover a bar for errors</p>
        {u.total === 0 ? (
          <p className="muted text-sm">
            No API requests in this period. Create a key on the <Link className="link" href="/api-keys">API keys</Link> page and see{" "}
            <Link className="link" href="/docs">API docs</Link>.
          </p>
        ) : (
          <div className="chart-cols" role="img" aria-label={`API requests per ${hourly ? "hour" : "day"}`}>
            {u.series.map((s, i) => {
              const label = hourly ? `${s.bucket.slice(11, 13)}:00` : s.bucket.slice(5);
              const showX = hourly ? i % 3 === 0 : u.series.length <= 7 || i % 5 === 0;
              return (
                <div key={s.bucket} className="chart-col" tabIndex={0}>
                  <span className="chart-tip">
                    {hourly ? `${s.bucket.slice(0, 10)} ${label}` : s.bucket}: {fmt(s.total)} requests, {fmt(s.errors)} errors
                  </span>
                  <div className="chart-bar" style={{ height: `${(s.total / max) * 100}%`, minHeight: s.total ? 2 : 0 }} />
                  {showX && <span className="chart-x">{label}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-3 mb-4">
        <section className="card table-wrap" style={{ padding: 0 }}>
          <h2 className="font-medium p-4 pb-2">By endpoint</h2>
          <table className="table" data-testid="usage-by-endpoint">
            <thead>
              <tr><th>Endpoint</th><th className="num">Requests</th><th className="num">Errors</th><th className="num">Avg ms</th><th className="num">Max ms</th></tr>
            </thead>
            <tbody>
              {u.byRoute.map((r) => (
                <tr key={r.method + r.route}>
                  <td className="mono"><span className="font-semibold">{r.method}</span> {r.route}</td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num" style={r.errors ? { color: "var(--warn)" } : undefined}>{fmt(r.errors)}</td>
                  <td className="num">{fmt(r.avgMs)}</td>
                  <td className="num">{fmt(r.maxMs)}</td>
                </tr>
              ))}
              {u.byRoute.length === 0 && <tr><td colSpan={5} className="muted">No requests.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card table-wrap" style={{ padding: 0 }}>
          <h2 className="font-medium p-4 pb-2">By key</h2>
          <table className="table" data-testid="usage-by-key">
            <thead>
              <tr><th>Key</th><th className="num">Requests</th><th className="num">Errors</th><th>Last request</th></tr>
            </thead>
            <tbody>
              {u.byKey.map((k) => (
                <tr key={k.keyId ?? "deleted"}>
                  <td>
                    {k.name} {k.prefix && <span className="mono muted">{k.prefix}…</span>}
                    {k.revoked && <span className="badge ml-2">revoked</span>}
                  </td>
                  <td className="num">{fmt(k.total)}</td>
                  <td className="num" style={k.errors ? { color: "var(--warn)" } : undefined}>{fmt(k.errors)}</td>
                  <td className="muted">{k.lastAt ? fmtDate(k.lastAt) : "—"}</td>
                </tr>
              ))}
              {u.byKey.length === 0 && <tr><td colSpan={4} className="muted">No requests.</td></tr>}
            </tbody>
          </table>
          {u.byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2 p-4 pt-3" data-testid="usage-by-status">
              {u.byStatus.map((s) => (
                <span key={s.status} className="inline-flex items-center gap-1 text-sm">
                  <StatusCode status={s.status} /> <span className="num">{fmt(s.total)}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card table-wrap" style={{ padding: 0 }}>
        <h2 className="font-medium p-4 pb-2">Recent requests</h2>
        <table className="table" data-testid="usage-recent">
          <thead>
            <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th className="num">ms</th><th>Key</th><th>IP</th></tr>
          </thead>
          <tbody>
            {u.recent.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDate(r.createdAt)}</td>
                <td className="mono font-semibold">{r.method}</td>
                <td className="mono" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }} title={r.path}>{r.path}</td>
                <td><StatusCode status={r.status} /></td>
                <td className="num">{fmt(r.durationMs)}</td>
                <td>{r.apiKey ? r.apiKey.name : <span className="muted">deleted</span>}</td>
                <td className="mono muted">{r.ip ?? "—"}</td>
              </tr>
            ))}
            {u.recent.length === 0 && <tr><td colSpan={7} className="muted">No requests.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
