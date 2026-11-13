/**
 * Database connection configuration.
 *
 * Provides Prisma-compatible connection strings for:
 * - Direct connections (migrations, seeding, admin)
 * - Pooled connections (runtime queries via PgBouncer)
 */

import { getEnv } from "./env.js";

/** Get the direct database URL (for migrations, Prisma CLI). */
export function getDatabaseUrl(): string {
  return getEnv().databaseUrl;
}

/** Get the pooled database URL (for application runtime). */
export function getPooledDatabaseUrl(): string {
  return getEnv().databaseUrlPooled;
}

/**
 * Prisma client configuration.
 * Uses pooled connection for runtime, direct for migrations.
 */
export interface PrismaClientConfig {
  datasourceUrl: string;
  /** Whether this is a pooled connection (transaction mode). */
  pooled: boolean;
}

/** Get Prisma client config for the current environment. */
export function getPrismaClientConfig(): PrismaClientConfig {
  const env = getEnv();
  // Use pooled URL for runtime, direct for migrations
  const isRuntime = typeof process !== "undefined" &&
    (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development");

  return {
    datasourceUrl: isRuntime ? env.databaseUrlPooled : env.databaseUrl,
    pooled: isRuntime,
  };
}

/**
 * Create a Prisma client with appropriate connection pooling settings.
 * For PgBouncer transaction pooling, we need to disable prepared statements.
 */
export function createPrismaClient(): { datasourceUrl: string; pooled: boolean } {
  return getPrismaClientConfig();
}

/**
 * Connection pool settings for PgBouncer transaction pooling.
 * Prisma requires these when using transaction pooling.
 */
export const PGBOUNCER_PRISMA_OPTIONS = {
  // Disable prepared statements (required for transaction pooling)
  __internal: {
    engine: {
      preparedStatements: false,
    },
  },
} as const;