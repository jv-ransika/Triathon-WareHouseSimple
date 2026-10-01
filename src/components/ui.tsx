import Link from "next/link";

const STATUS_COLOR: Record<string, string> = {
  reserved: "var(--warn)",
  pending: "var(--accent)",
  shipped: "var(--accent)",
  delivered: "var(--good)",
  cancelled: "var(--bad)",
  expired: "var(--muted)",
};

const STATUS_LABEL: Record<string, string> = { reserved: "awaiting confirmation" };

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="badge">
      <span className="dot" style={{ background: STATUS_COLOR[status] ?? "var(--muted)" }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Storage temperature of a product or order: ambient, chilled or mixed. */
export function TempBadge({ temp }: { temp: string }) {
  const chilled = temp === "chilled";
  return (
    <span className="badge" data-temp={temp} style={chilled ? { borderColor: "var(--chart)", color: "var(--chart)" } : undefined}>
      <span aria-hidden="true">{chilled ? "❄" : temp === "mixed" ? "◐" : "☀"}</span>
      {temp}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Prev/next pager preserving existing query params. */
export function Pager({
  page,
  limit,
  total,
  basePath,
  params,
}: {
  page: number;
  limit: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    qs.set("page", String(p));
    return `${basePath}?${qs}`;
  };
  return (
    <div className="flex items-center justify-between gap-3 mt-3 text-sm">
      <span className="muted">
        {total.toLocaleString()} results · page {page} of {pages.toLocaleString()}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="btn btn-ghost btn-sm" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="btn btn-ghost btn-sm" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtDate = (d: Date) =>
  d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
