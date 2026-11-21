import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
// One client per process; Next dev hot-reload would otherwise open a pool per reload.
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export * from "@prisma/client";
export * from "./signature";
export * from "./crypto";
export * from "./password";
export * from "./window";
export * from "./labels";
