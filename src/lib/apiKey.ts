import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateApiKey() {
  const bytes = randomBytes(32);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  const key = `wh_${body}`;
  return { key, prefix: key.slice(0, 10), keyHash: hashApiKey(key) };
}

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

function extractKey(req: Request) {
  const header = req.headers.get("x-api-key");
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

/** Looks up the key sent with the request, including revoked keys (null if missing/unknown). */
export async function lookupApiKey(req: Request) {
  const key = extractKey(req);
  if (!key) return null;
  return prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
}
