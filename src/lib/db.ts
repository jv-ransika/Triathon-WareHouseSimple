import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

function makeClient() {
  // TURSO_* (set by the Vercel Turso integration) win over DATABASE_* (local/manual setup).
  const adapter = new PrismaLibSQL({
    url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./dev.db",
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
