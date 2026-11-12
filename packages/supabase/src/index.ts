/**
 * Supabase integration for FitCoach.
 *
 * Exports:
 * - Server client (service role)
 * - Browser client (anon key)
 * - Environment validation
 * - Database connection helpers
 */

// Shared
export { getEnv, resetEnvCache, requireEnv, type ValidatedEnv, ConfigError } from "./shared/env";

// Server
export { getServerSupabase, createServerSupabaseWithAuth, resetServerSupabase } from "./server/client";

// Browser
export { getBrowserSupabase, resetBrowserSupabase, getBrowserSession } from "./browser/client";

// Database
export { getDatabaseUrl, getPooledDatabaseUrl, createPrismaClient } from "./shared/database";