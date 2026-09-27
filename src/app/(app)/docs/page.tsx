import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

type Endpoint = { method: string; path: string; desc: string; body?: string; example: string; response?: string };

export default async function DocsPage() {
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const K = `-H "x-api-key: $WH_KEY"`;

  const endpoints: Endpoint[] = [
    {
      method: "GET",
      path: "/api/v1/usage",
      desc:
        "Usage of all API keys owned by the caller: totals, error rate, latency, requests per hour/day, per endpoint, per key, per status and the 20 most recent requests. Query: range (24h|7d|30d, default 7d). The same data is on the API usage page.",
      example: `curl ${K} "${base}/api/v1/usage?range=24h"`,
      response: `{ "data": { "range": "24h", "total_requests": 128, "errors": 3, "unauthorized": 1, "error_rate": 0.0234,
    "avg_ms": 84, "max_ms": 912, "series": [{ "bucket": "2026-09-28T10", "total": 12, "errors": 0 }, ...],
    "by_endpoint": [{ "endpoint": "GET /api/v1/products", "requests": 80, "errors": 0, "avg_ms": 60, "max_ms": 300 }, ...],
    "by_key": [...], "by_status": [{ "status": 200, "total": 120 }, ...], "recent": [...] } }`,
    },
    {
      method: "GET",
      path: "/api/v1/warehouses",
      desc: "List warehouses with units available, units locked and order counts by status.",
      example: `curl ${K} ${base}/api/v1/warehouses`,
      response: `{ "data": [{ "code": "KDY", "name": "Kandy", "units_available": 280000, "units_reserved": 0,
    "orders": { "delivered": 48665 } }, { "code": "PLG", "name": "Peliyagoda", ... }] }`,
    },
    {
      method: "GET",
      path: "/api/v1/products",
      desc:
        "List products with stock per warehouse. Query: brand (Fresh|Style|Tech), q (ID contains), warehouse (KDY|PLG, used by sort and low_stock), sort=stock (lowest first), low_stock=true (below 50), page, limit (max 100).",
      example: `curl ${K} "${base}/api/v1/products?warehouse=KDY&sort=stock&limit=5"`,
      response: `{ "data": [{ "product_id": "C32_TECH_001", "brand": "Tech", "unit_weight_kg": 57.8,
    "unit_volume_m3": 0.18, "basis": "observed_single_unit", "verified_real_sku": false,
    "stock": { "KDY": { "available": 1000, "reserved": 0 }, "PLG": { "available": 1000, "reserved": 0 } },
    "total_available": 2000, "total_reserved": 0, "updated_at": "..." }], "page": 1, "limit": 5, "total": 280 }`,
    },
    { method: "GET", path: "/api/v1/products/:id", desc: "Get one product.", example: `curl ${K} ${base}/api/v1/products/C32_TECH_001` },
    {
      method: "PATCH",
      path: "/api/v1/products/:id",
      desc: "Set ({ stock }) or adjust ({ adjust: +n / -n }) the available stock in one warehouse.",
      body: `{ "warehouse": "KDY", "stock": 500 }   or   { "warehouse": "PLG", "adjust": -20 }`,
      example: `curl -X PATCH ${K} -H "Content-Type: application/json" \\\n  -d '{"warehouse":"KDY","adjust":50}' ${base}/api/v1/products/C32_TECH_001`,
    },
    {
      method: "POST",
      path: "/api/v1/products/:id/transfer",
      desc: "Move available units from one warehouse to the other. 409 if the source doesn't have enough.",
      body: `{ "from": "KDY", "to": "PLG", "quantity": 25 }`,
      example: `curl -X POST ${K} -H "Content-Type: application/json" \\\n  -d '{"from":"KDY","to":"PLG","quantity":25}' ${base}/api/v1/products/C32_TECH_001/transfer`,
    },
    {
      method: "GET",
      path: "/api/v1/orders",
      desc: "List orders, newest first. Query: warehouse (KDY|PLG), status (reserved|pending|shipped|delivered|cancelled|expired), page, limit.",
      example: `curl ${K} "${base}/api/v1/orders?warehouse=PLG&status=pending"`,
    },
    {
      method: "GET",
      path: "/api/v1/orders/:id",
      desc: "Get one order with its items. :id is the order code, e.g. ORD0000001. Reserved orders also include shortfall.",
      example: `curl ${K} ${base}/api/v1/orders/ORD0000001`,
      response: `{ "data": { "order_id": "ORD0000001", "status": "delivered", "warehouse": { "code": "KDY", "name": "Kandy" },
    "source": "seed", "total_weight_kg": 70.77, "total_volume_m3": 0.4023, "expires_at": null, "created_at": "...",
    "items": [{ "product_id": "C32_FRESH_019", "quantity": 4, "requested_quantity": 4 }, ...] } }`,
    },
    {
      method: "POST",
      path: "/api/v1/orders",
      desc:
        "Place an order in one warehouse. 201: everything available, stock taken, status pending. 202: some lines short. The available units are locked (status reserved) until you confirm, cancel, or expires_at passes; the response lists the shortfall and what the other warehouse has. 409: nothing available.",
      body: `{ "warehouse": "KDY", "items": [{ "product_id": "C32_TECH_001", "quantity": 2 }] }`,
      example: `curl -X POST ${K} -H "Content-Type: application/json" \\\n  -d '{"warehouse":"KDY","items":[{"product_id":"C32_TECH_001","quantity":2}]}' ${base}/api/v1/orders`,
      response: `202 { "data": { "order_id": "ORD0097350", "status": "reserved", "expires_at": "...",
    "items": [{ "product_id": "C32_TECH_001", "quantity": 40, "requested_quantity": 60 }], ... },
  "shortfall": [{ "product_id": "C32_TECH_001", "requested": 60, "reserved": 40, "shortfall": 20,
    "other_warehouse": { "code": "PLG", "name": "Peliyagoda", "available": 1000 } }] }`,
    },
    {
      method: "POST",
      path: "/api/v1/orders/:id/confirm",
      desc: "Accept a reserved order with the locked quantities. It becomes pending. 409 reservation_expired if the lock ran out.",
      example: `curl -X POST ${K} ${base}/api/v1/orders/ORD0097350/confirm`,
    },
    {
      method: "PUT",
      path: "/api/v1/orders/:id/status",
      desc:
        "Change status. Allowed: reserved → pending (same as confirm) | cancelled, pending → shipped | cancelled, shipped → delivered. Cancelling returns units to the order's warehouse.",
      example: `curl -X PUT ${K} -H "Content-Type: application/json" \\\n  -d '{"status":"shipped"}' ${base}/api/v1/orders/ORD0097350/status`,
    },
  ];

  return (
    <>
      <PageHeader title="API docs" subtitle="JSON REST API authenticated with an API key." />

      <section className="card space-y-2 mb-4">
        <h2 className="font-medium">Authentication</h2>
        <p>
          Create a key on the <Link className="link" href="/api-keys">API keys</Link> page and send it in the{" "}
          <code className="mono">x-api-key</code> header (or <code className="mono">Authorization: Bearer &lt;key&gt;</code>).
        </p>
        <pre className="mono p-3 rounded-md overflow-x-auto" style={{ background: "var(--bg)" }}>export WH_KEY=wh_xxxxxxxx</pre>
        <h2 className="font-medium pt-2">Errors</h2>
        <p>
          Errors return <code className="mono">{`{ "error": { "code", "message" } }`}</code> with status 400 (bad JSON), 401 (missing/revoked key),
          404 (not found), 409 (insufficient stock / invalid status change / reservation expired) or 422 (validation).
        </p>
        <h2 className="font-medium pt-2">Warehouses</h2>
        <p>
          Two warehouses: <code className="mono">KDY</code> (Kandy) and <code className="mono">PLG</code> (Peliyagoda). Anywhere a
          warehouse is expected you can also pass its name, case-insensitive (<code className="mono">kandy</code>).
        </p>
      </section>

      <div className="space-y-3">
        {endpoints.map((e) => (
          <section key={e.method + e.path} className="card space-y-2">
            <div className="flex items-center gap-2">
              <span className="badge mono font-semibold">{e.method}</span>
              <code className="mono font-medium">{e.path}</code>
            </div>
            <p className="muted">{e.desc}</p>
            {e.body && <pre className="mono p-3 rounded-md overflow-x-auto" style={{ background: "var(--bg)" }}>{e.body}</pre>}
            <pre className="mono p-3 rounded-md overflow-x-auto" style={{ background: "var(--bg)" }}>{e.example}</pre>
            {e.response && (
              <pre className="mono p-3 rounded-md overflow-x-auto muted" style={{ background: "var(--bg)" }}>{e.response}</pre>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
