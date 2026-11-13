/**
 * Server-side Supabase client.
 *
 * Uses the service role key for administrative operations.
 * Never expose this client or its key to the browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "../shared/env.js";

let serverClient: SupabaseClient | null = null;

/**
 * Get or create the server-side Supabase client.
 * Uses service role key for full administrative access.
 */
export function getServerSupabase(): SupabaseClient {
  if (serverClient) return serverClient;

  const env = getEnv();
  if (!env.hasSupabase) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  serverClient = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: "public",
    },
    global: {
      headers: {
        "X-Client-Info": "fitcoach-server",
      },
    },
  });

  return serverClient;
}

/**
 * Create a new server client with a specific JWT (for request-scoped auth).
 * The JWT is verified by Supabase and used for RLS context.
 */
export function createServerSupabaseWithAuth(jwt: string): SupabaseClient {
  const env = getEnv();
  if (!env.hasSupabase) {
    throw new Error("Supabase not configured");
  }

  return createClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "X-Client-Info": "fitcoach-server-auth",
      },
    },
    db: {
      schema: "public",
    },
  });
}

/** Reset singleton (for testing). */
export function resetServerSupabase(): void {
  serverClient = null;
}