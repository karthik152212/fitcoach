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
export { getEnv, resetEnvCache, requireEnv, type ValidatedEnv, ConfigError } from "./shared/env.js";

// Server
export { getServerSupabase, createServerSupabaseWithAuth, resetServerSupabase } from "./server/client.js";

// Browser
export { getBrowserSupabase, resetBrowserSupabase, getBrowserSession, signOut } from "./browser/client.js";

// Database
export { getDatabaseUrl, getPooledDatabaseUrl, createPrismaClient } from "./shared/database.js";