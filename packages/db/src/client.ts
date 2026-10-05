import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient factory.
 *
 * Security note (milestone §15): query logging is deliberately left off.
 * Prisma's query events include bind parameters — meals, body metrics and
 * notes are health data and must never reach application logs. Only
 * warnings/errors (without parameter payloads) are emitted.
 */
export interface CreatePrismaClientOptions {
  /** Connection URL; falls back to the DATABASE_URL environment variable. */
  url?: string;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.url ? { datasourceUrl: options.url } : {}),
    log: [
      { level: "warn", emit: "stdout" },
      { level: "error", emit: "stdout" },
    ],
  });
}
