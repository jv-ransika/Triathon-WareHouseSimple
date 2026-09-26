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
      path: "/api/v1/products",
      desc: "List products. Query: brand (Fresh|Style|Tech), q (ID contains), page, limit (max 100).",
      example: `curl ${K} "${base}/api/v1/products?brand=Tech&limit=5"`,
      response: `{ "data": [{ "product_id": "C32_TECH_001", "brand": "Tech", "unit_weight_kg": 57.8,
    "unit_volume_m3": 0.18, "basis": "observed_single_unit", "verified_real_sku": false,
    "stock": 1000, "updated_at": "..." }], "page": 1, "limit": 5, "total": 178 }`,
    },
    { method: "GET", path: "/api/v1/products/:id", desc: "Get one product.", example: `curl ${K} ${base}/api/v1/products/C32_TECH_001` },
    {
      method: "PATCH",
      path: "/api/v1/products/:id",
      desc: "Set stock ({ \"stock\": n }) or adjust it ({ \"adjust\": +n / -n }).",
      example: `curl -X PATCH ${K} -H "Content-Type: application/json" \\\n  -d '{"adjust": 50}' ${base}/api/v1/products/C32_TECH_001`,
    },
    {
      method: "GET",
      path: "/api/v1/orders",
      desc: "List orders, newest first. Query: status (pending|shipped|delivered|cancelled), page, limit.",
      example: `curl ${K} "${base}/api/v1/orders?status=pending"`,
    },
    {
      method: "GET",
      path: "/api/v1/orders/:id",
      desc: "Get one order with its items. :id is the order code, e.g. ORD0000001.",
      example: `curl ${K} ${base}/api/v1/orders/ORD0000001`,
      response: `{ "data": { "order_id": "ORD0000001", "status": "delivered", "source": "seed",
    "total_weight_kg": 70.77, "total_volume_m3": 0.4023, "created_at": "...",
    "items": [{ "product_id": "C32_FRESH_019", "quantity": 4 }, ...] } }`,
    },
    {
      method: "POST",
      path: "/api/v1/orders",
      desc: "Place an order. Stock is decremented atomically; the whole order fails if any line lacks stock. Returns 201.",
      body: `{ "items": [{ "product_id": "C32_TECH_001", "quantity": 2 }] }`,
      example: `curl -X POST ${K} -H "Content-Type: application/json" \\\n  -d '{"items":[{"product_id":"C32_TECH_001","quantity":2}]}' ${base}/api/v1/orders`,
    },
    {
      method: "PUT",
      path: "/api/v1/orders/:id/status",
      desc: "Change status. Allowed: pending → shipped | cancelled, shipped → delivered. Cancelling restores stock.",
      example: `curl -X PUT ${K} -H "Content-Type: application/json" \\\n  -d '{"status":"shipped"}' ${base}/api/v1/orders/ORD0097322/status`,
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
          404 (not found), 409 (insufficient stock / invalid status change) or 422 (validation).
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
