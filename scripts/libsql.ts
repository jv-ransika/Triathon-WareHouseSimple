import "dotenv/config";
import { createClient, type Client } from "@libsql/client";

export function dbClient(): Client {
  // TURSO_* (set by the Vercel Turso integration) win over DATABASE_* (local/manual setup).
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (or TURSO_DATABASE_URL) is not set");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined });

  // Retry network-level failures (flaky connections to a remote Turso DB). Batches are
  // transactional, so a failed batch left nothing behind and is safe to resend.
  const retry =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await fn(...args);
        } catch (e) {
          const msg = String((e as Error)?.message ?? e) + String((e as { cause?: unknown })?.cause ?? "");
          if (attempt >= 5 || !/fetch failed|timeout|ECONNRESET|ETIMEDOUT|socket/i.test(msg)) throw e;
          console.warn(`\n  network error, retry ${attempt}/4…`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    };
  client.execute = retry(client.execute.bind(client)) as Client["execute"];
  client.batch = retry(client.batch.bind(client)) as Client["batch"];
  return client;
}
