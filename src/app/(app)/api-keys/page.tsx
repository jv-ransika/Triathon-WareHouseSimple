import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, fmtDate } from "@/components/ui";
import { deleteApiKeyAction, revokeApiKeyAction } from "../actions";
import CreateKeyForm from "./CreateKeyForm";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await requireUser();
  const keys = await prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Keys authenticate requests to the public API. Each key is shown only once."
        action={<Link className="link text-sm" href="/docs">API docs →</Link>}
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
                <td colSpan={6} className="muted">No API keys yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
