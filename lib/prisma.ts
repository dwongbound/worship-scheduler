// Prisma client singleton. Next.js hot-reload re-imports modules constantly
// in dev; caching the client on globalThis prevents "too many connections".
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to initialize Prisma.");

  return new PrismaClient({
    adapter: new PrismaPg(url),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
