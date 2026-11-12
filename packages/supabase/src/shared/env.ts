/**
 * Centralized environment configuration.
 *
 * Single source of truth for all environment variables.
 * Validates required variables at startup and provides typed access.
 */

type EnvMode = "development" | "production" | "test";

/** Validated and typed environment configuration. */
export interface ValidatedEnv {
  /** PostgreSQL connection string for migrations and direct operations. */
  readonly databaseUrl: string;
  /** Pooled connection string for runtime queries (PgBouncer). Falls back to databaseUrl. */
  readonly databaseUrlPooled: string;
  /** Supabase project URL. */
  readonly supabaseUrl: string | null;
  /** Supabase anon key (safe for browser). */
  readonly supabaseAnonKey: string | null;
  /** Supabase service role key (server-only). */
  readonly supabaseServiceRoleKey: string | null;
  /** AI provider selection. */
  readonly aiProvider: "mock" | "anthropic" | "openai";
  /** Anthropic API key (when provider is anthropic). */
  readonly anthropicApiKey: string | null;
  /** OpenAI API key (when provider is openai). */
  readonly openaiApiKey: string | null;
  /** API server port. */
  readonly port: number;
  /** External test database URL. */
  readonly testDatabaseUrl: string | null;
  /** Current environment mode. */
  readonly mode: EnvMode;
  /** Whether Supabase is configured (all three vars present). */
  readonly hasSupabase: boolean;
}

/**
 * Validates and returns the complete environment configuration.
 * Throws on missing required variables in production.
 */
export function validateEnv(): ValidatedEnv {
  const mode = (process.env.NODE_ENV as EnvMode) ?? "development";
  const isProduction = mode === "production";

  // Required: DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError("DATABASE_URL is required");
  }

  // Optional: DATABASE_URL_POOLED (falls back to DATABASE_URL)
  const databaseUrlPooled = process.env.DATABASE_URL_POOLED ?? databaseUrl;

  // Supabase (optional in dev/test, required in production)
  const supabaseUrl = process.env.SUPABASE_URL ?? null;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? null;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey);

  if (isProduction && !hasSupabase) {
    throw new ConfigError(
      "Production requires Supabase configuration: " +
      "SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  // AI Provider
  const aiProvider = (process.env.AI_PROVIDER as ValidatedEnv["aiProvider"]) ?? "mock";
  if (!["mock", "anthropic", "openai"].includes(aiProvider)) {
    throw new ConfigError(`Invalid AI_PROVIDER: ${aiProvider}. Must be "mock", "anthropic", or "openai"`);
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const openaiApiKey = process.env.OPENAI_API_KEY ?? null;

  // Validate provider-specific keys
  if (aiProvider === "anthropic" && !anthropicApiKey) {
    throw new ConfigError("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }
  if (aiProvider === "openai" && !openaiApiKey) {
    throw new ConfigError("AI_PROVIDER=openai requires OPENAI_API_KEY");
  }

  // Port
  const port = Number(process.env.PORT ?? 8787);

  // Test database
  const testDatabaseUrl = process.env.FITCOACH_TEST_DATABASE_URL ?? null;

  return {
    databaseUrl,
    databaseUrlPooled,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    aiProvider,
    anthropicApiKey,
    openaiApiKey,
    port,
    testDatabaseUrl,
    mode,
    hasSupabase,
  };
}

/**
 * Configuration error — thrown when environment validation fails.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// Lazy singleton — validated on first access
let cachedEnv: ValidatedEnv | null = null;

/** Get validated environment (validates on first call). */
export function getEnv(): ValidatedEnv {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}

/** Reset cache (for testing only). */
export function resetEnvCache(): void {
  cachedEnv = null;
}

/** Type-safe access to a specific variable with validation. */
export function requireEnv<K extends keyof ValidatedEnv>(key: K): ValidatedEnv[K] {
  const env = getEnv();
  const value = env[key];
  if (value === null || value === undefined) {
    throw new ConfigError(`Required environment variable ${key} is not set`);
  }
  return value;
}