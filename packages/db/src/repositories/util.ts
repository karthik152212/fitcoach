import { toRepositoryError } from "../errors";
import type { PrismaClient } from "@prisma/client";

/**
 * Run a repository operation and translate any storage failure into the
 * repository error taxonomy, so upper layers never see Prisma error types.
 */
export async function runDb<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toRepositoryError(error);
  }
}

/**
 * Prisma transaction client type (extracted from Prisma namespace).
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

/**
 * Run a database operation within an interactive transaction with RLS context.
 * Sets `app.current_user_id` transaction-locally via SET LOCAL for PgBouncer
 * transaction pooling compatibility.
 */
export async function withUserTransaction<T>(
  prisma: PrismaClient,
  userId: string,
  operation: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Set transaction-local RLS context - parameterized to prevent injection
    await tx.$executeRaw`SET LOCAL "app.current_user_id" = ${userId}::uuid`;
    return operation(tx as TransactionClient);
  });
}

/** Clamp list limits to a sane, bounded range. */
export function boundedLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit), max));
}
