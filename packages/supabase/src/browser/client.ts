/**
 * Browser-side Supabase client.
 *
 * Uses the anon key only — safe for client bundles.
 * Session persistence handled by Supabase Auth.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "../shared/env";

let browserClient: SupabaseClient | null = null;

/** Check if running in a browser environment. */
function isBrowser(): boolean {
  return typeof globalThis !== "undefined" &&
    typeof (globalThis as Record<string, unknown>).window !== "undefined" &&
    typeof ((globalThis as Record<string, unknown>).window as Record<string, unknown>).localStorage !== "undefined";
}

/** Get localStorage if available (browser only). */
function getLocalStorage(): Storage | undefined {
  if (!isBrowser()) return undefined;
  return ((globalThis as Record<string, unknown>).window as { localStorage: Storage }).localStorage;
}

/**
 * Get or create the browser-side Supabase client.
 * Uses anon key; session persisted in localStorage by default.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  const env = getEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error(
      "Supabase not configured for browser. Set SUPABASE_URL and SUPABASE_ANON_KEY",
    );
  }

  browserClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: getLocalStorage(),
      storageKey: "fitcoach-auth",
    },
    db: {
      schema: "public",
    },
    global: {
      headers: {
        "X-Client-Info": "fitcoach-browser",
      },
    },
  });

  return browserClient;
}

/** Reset singleton (for testing). */
export function resetBrowserSupabase(): void {
  browserClient = null;
}

/**
 * Get the current session from the browser client.
 * Returns null if not authenticated or Supabase not configured.
 */
export async function getBrowserSession(): Promise<{
  accessToken: string;
  user: { id: string; email?: string };
} | null> {
  try {
    const supabase = getBrowserSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return {
      accessToken: session.access_token,
      user: { id: session.user.id, email: session.user.email ?? undefined },
    };
  } catch {
    return null;
  }
}