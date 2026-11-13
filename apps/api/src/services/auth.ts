/**
 * Authentication service — Supabase Auth integration.
 *
 * Handles signup, login, logout, session refresh, and user synchronization.
 * Server-side JWT verification is performed by the auth middleware.
 * When Supabase is not configured (e.g., tests, mock mode), returns clear errors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@fitcoach/domain";
import type { UserRepository } from "@fitcoach/db";

type GetServerSupabaseFn = () => SupabaseClient;
type CreateServerSupabaseWithAuthFn = (jwt: string) => SupabaseClient;

let getServerSupabaseFn: GetServerSupabaseFn | null = null;
let createServerSupabaseWithAuthFn: CreateServerSupabaseWithAuthFn | null = null;

async function loadSupabase(): Promise<void> {
  if (getServerSupabaseFn && createServerSupabaseWithAuthFn) return;
  const supabaseModule = await import("@fitcoach/supabase");
  getServerSupabaseFn = supabaseModule.getServerSupabase as unknown as GetServerSupabaseFn;
  createServerSupabaseWithAuthFn = supabaseModule.createServerSupabaseWithAuth as unknown as CreateServerSupabaseWithAuthFn;
}

function getServerSupabase(): SupabaseClient {
  if (!getServerSupabaseFn) {
    throw new Error("Supabase not loaded. Call loadSupabase() first.");
  }
  return getServerSupabaseFn();
}

function createServerSupabaseWithAuth(jwt: string): SupabaseClient {
  if (!createServerSupabaseWithAuthFn) {
    throw new Error("Supabase not loaded. Call loadSupabase() first.");
  }
  return createServerSupabaseWithAuthFn(jwt);
}

/** Auth credentials for signup/login. */
export interface AuthCredentials {
  email: string;
  password: string;
}

/** Result of an auth operation. */
export interface AuthResult {
  user: { id: string; email: string } | null;
  session: { accessToken: string; refreshToken: string; expiresAt: number } | null;
  error?: string;
}

/** User sync result. */
export interface SyncResult {
  user: User;
  created: boolean;
}

/**
 * Error when Supabase is not configured but an auth operation is attempted.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor(operation: string) {
    super(`Supabase not configured - cannot ${operation}. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY`);
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Authentication service using Supabase Auth.
 * Gracefully handles missing Supabase configuration for tests/mock mode.
 */
export class AuthService {
  private supabase: SupabaseClient | null;
  private userRepository?: UserRepository;
  private initialized = false;

  constructor(supabase?: SupabaseClient | null) {
    this.supabase = supabase ?? null;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await loadSupabase();
    if (!this.supabase) {
      try {
        this.supabase = getServerSupabase();
      } catch {
        this.supabase = null;
      }
    }
    this.initialized = true;
  }

  /**
   * Set the user repository (called after services are created).
   */
  setUserRepository(repo: UserRepository): void {
    this.userRepository = repo;
  }

  /**
   * Check if Supabase is available.
   */
  private async requireSupabase(operation: string): Promise<SupabaseClient> {
    await this.ensureInitialized();
    if (!this.supabase) {
      throw new SupabaseNotConfiguredError(operation);
    }
    return this.supabase;
  }

  /**
   * Sign up a new user with email and password.
   * Also creates/updates the local user record.
   */
  async signUp(credentials: AuthCredentials): Promise<AuthResult> {
    const supabase = await this.requireSupabase("sign up");
    const { data, error } = await supabase.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true, // Auto-confirm for development
    });

    if (error) {
      return { user: null, session: null, error: error.message };
    }

    if (!data.user) {
      return { user: null, session: null, error: "User creation failed" };
    }

    // Sync local user record
    if (this.userRepository) {
      await this.syncUser(data.user.id, data.user.email ?? "");
    }

    return {
      user: { id: data.user.id, email: data.user.email ?? "" },
      session: null, // No session on admin create
      error: undefined,
    };
  }

  /**
   * Sign in with email and password.
   * Returns session tokens for the client.
   */
  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    const supabase = await this.requireSupabase("sign in");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      return { user: null, session: null, error: error.message };
    }

    if (!data.session || !data.user) {
      return { user: null, session: null, error: "Sign in failed" };
    }

    // Sync local user record
    if (this.userRepository) {
      await this.syncUser(data.user.id, data.user.email ?? "");
    }

    return {
      user: { id: data.user.id, email: data.user.email ?? "" },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token ?? "",
        expiresAt: data.session.expires_at ?? 0,
      },
      error: undefined,
    };
  }

  /**
   * Sign out the current user (revokes refresh token).
   */
  async signOut(accessToken: string): Promise<{ error?: string }> {
    await this.requireSupabase("sign out");
    const userClient = createServerSupabaseWithAuth(accessToken);
    const { error } = await userClient.auth.signOut();
    if (error) return { error: error.message };
    return {};
  }

  /**
   * Refresh an access token using a refresh token.
   */
  async refreshSession(refreshToken: string): Promise<AuthResult> {
    const supabase = await this.requireSupabase("refresh session");
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      return { user: null, session: null, error: error.message };
    }

    if (!data.session || !data.user) {
      return { user: null, session: null, error: "Session refresh failed" };
    }

    return {
      user: { id: data.user.id, email: data.user.email ?? "" },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token ?? "",
        expiresAt: data.session.expires_at ?? 0,
      },
      error: undefined,
    };
  }

  /**
   * Get the current user from an access token.
   * Verifies the JWT and returns the user.
   */
  async getUserFromToken(accessToken: string): Promise<{ id: string; email?: string } | null> {
    await this.requireSupabase("verify token");
    const userClient = createServerSupabaseWithAuth(accessToken);
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return null;
    return { id: user.id, email: user.email ?? undefined };
  }

  /**
   * Synchronize a Supabase user with the local database.
   * Creates or updates the local user record.
   * This is called after successful authentication.
   */
  async syncUser(supabaseUserId: string, email: string): Promise<SyncResult> {
    if (!this.userRepository) {
      throw new Error("User repository not set - call setUserRepository first");
    }

    // Check if user exists by email
    let existing = await this.userRepository.findByEmail(email);

    if (existing) {
      // Update external_auth_id if not set
      if (!existing.externalAuthId) {
        existing = await this.userRepository.update(existing.id, { externalAuthId: supabaseUserId });
      }
      // If external_auth_id differs, it's a conflict
      else if (existing.externalAuthId !== supabaseUserId) {
        throw new Error(`User ${email} already linked to different Supabase account`);
      }
      return { user: existing, created: false };
    }

    // Create new local user
    const user = await this.userRepository.create({
      id: supabaseUserId,
      email,
      externalAuthId: supabaseUserId,
      timezone: "UTC",
    });

    return { user, created: true };
  }

  /**
   * Verify a JWT and return the user ID.
   * Used by middleware for request authentication.
   */
  async verifyToken(accessToken: string): Promise<string | null> {
    const user = await this.getUserFromToken(accessToken);
    return user?.id ?? null;
  }
}

/**
 * Create an AuthService instance.
 * If Supabase is not configured, returns a service that will throw
 * SupabaseNotConfiguredError on auth operations.
 */
export function createAuthService(): AuthService {
  return new AuthService();
}