import "dotenv/config";
import { createClient } from "@libsql/client";

export function dbClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
}
