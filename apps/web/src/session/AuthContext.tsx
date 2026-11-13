import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { getBrowserSupabase, getBrowserSession, signOut as supabaseSignOut } from "@fitcoach/supabase";

const STORAGE_KEY = "fitcoach.userId";
const SESSION_KEY = "fitcoach.session";

interface User {
  id: string;
  email?: string;
}

interface SessionValue {
  user: User | null;
  session: { accessToken: string; refreshToken: string; expiresAt: number } | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  initializeSession: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const id = localStorage.getItem(STORAGE_KEY);
      return id ? { id } : null;
    } catch {
      return null;
    }
  });

  const [session, setSession] = useState<{ accessToken: string; refreshToken: string; expiresAt: number } | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(true);

  // Initialize session on mount
  const initializeSession = useCallback(async () => {
    try {
      const existingSession = await getBrowserSession();
      if (existingSession) {
        const { accessToken, refreshToken, expiresAt, user } = existingSession;
        setSession({ accessToken, refreshToken, expiresAt });
        setUser({ id: user?.id ?? "", email: user?.email });
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken, refreshToken, expiresAt }));
          localStorage.setItem(STORAGE_KEY, user?.id ?? "");
        } catch { /* ignore */ }
      }
    } catch {
      // Supabase not configured or no session
    } finally {
      setLoading(false);
    }
  }, []);

  // Run initialization
  // Note: In a real app, you'd use useEffect here. For simplicity we rely on
  // the consumer to call initializeSession or handle it in a parent effect.
  // We'll provide a way to trigger it.

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (data.session) {
        const { access_token, refresh_token, expires_at } = data.session;
        const expiresAt = (expires_at ?? 0) * 1000;
        setSession({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt });
        setUser({ id: data.user?.id ?? "", email: data.user?.email });
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt }));
          localStorage.setItem(STORAGE_KEY, data.user?.id ?? "");
        } catch { /* ignore */ }
      }
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Sign up failed" };
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      if (data.session) {
        const { access_token, refresh_token, expires_at } = data.session;
        const expiresAt = (expires_at ?? 0) * 1000;
        setSession({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt });
        setUser({ id: data.user?.id ?? "", email: data.user?.email });
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt }));
          localStorage.setItem(STORAGE_KEY, data.user?.id ?? "");
        } catch { /* ignore */ }
      }
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Sign in failed" };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabaseSignOut();
    } catch { /* ignore */ }
    setUser(null);
    setSession(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (data.session) {
        const { access_token, refresh_token, expires_at } = data.session;
        const expiresAt = (expires_at ?? 0) * 1000;
        setSession({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt });
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: access_token, refreshToken: refresh_token ?? "", expiresAt }));
        } catch { /* ignore */ }
      }
    } catch {
      // Refresh failed - sign out
      await signOut();
    }
  }, [signOut]);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signUp,
      signIn,
      signOut,
      refreshSession,
      initializeSession,
    }),
    [user, session, loading, signUp, signIn, signOut, refreshSession, initializeSession],
  );

  return (
    <SessionContext.Provider value={value}>
      <Outlet />
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

export function useAuth() {
  const { user, session, signIn, signOut, signUp, loading, refreshSession, initializeSession } = useSession();
  return {
    user,
    session,
    loading,
    isAuthenticated: !!user,
    signIn,
    signOut,
    signUp,
    refreshSession,
    initializeSession,
  };
}