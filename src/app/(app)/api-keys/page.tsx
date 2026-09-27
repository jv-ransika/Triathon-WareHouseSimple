import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requestCountsByKey } from "@/lib/usage";
import { PageHeader, fmt, fmtDate } from "@/components/ui";
import { deleteApiKeyAction, revokeApiKeyAction } from "../actions";
import CreateKeyForm from "./CreateKeyForm";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await requireUser();
  const [keys, counts] = await Promise.all([
    prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    requestCountsByKey(user.id, 7),
  ]);

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Keys authenticate requests to the public API. Each key is shown only once."
        action={
          <div className="flex gap-4 text-sm">
            <Link className="link" href="/api-usage">Usage →</Link>
            <Link className="link" href="/docs">API docs →</Link>
          </div>
        }
      />
      <CreateKeyForm />

      <div className="card table-wrap mt-4" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Created</th>
              <th>Last used</th>
              <th className="num">Requests (7d)</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.prefix}…</td>
                <td className="muted">{fmtDate(k.createdAt)}</td>
                <td className="muted">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "Never"}</td>
                <td className="num">{fmt(counts.get(k.id) ?? 0)}</td>
                <td>
                  <span className="badge">
                    <span className="dot" style={{ background: k.revokedAt ? "var(--bad)" : "var(--good)" }} />
                    {k.revokedAt ? "revoked" : "active"}
                  </span>
                </td>
                <td className="num">
                  <form action={k.revokedAt ? deleteApiKeyAction : revokeApiKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="btn btn-danger btn-sm">{k.revokedAt ? "Delete" : "Revoke"}</button>
                  </form>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">No API keys yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
