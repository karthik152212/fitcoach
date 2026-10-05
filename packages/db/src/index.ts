/**
 * FitCoach persistence layer.
 *
 * Layering (milestone §10):
 *
 *   domain → application/service → repository (this package) → Prisma → PostgreSQL
 *
 * Nothing outside this package imports Prisma; application code depends on
 * the repository interfaces exported here. The domain stays persistence-
 * agnostic: every row↔domain translation lives in the mappers below.
 */
export * from "./ids";
export * from "./errors";
export * from "./client";
export * from "./mapping";
export * from "./repositories";
export { startTestPostgres, migrateDeploy } from "./testing/postgres";
export type { TestPostgres } from "./testing/postgres";
export { seedDatabase, SEED_FIXTURE_LABEL } from "./seed/seed";
export type { SeedResult } from "./seed/seed";
