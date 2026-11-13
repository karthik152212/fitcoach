import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Current-person context. FitCoach is single-user on this device for Phase 4:
 * onboarding creates (or resumes) the user and the id stays on this device.
 */

const STORAGE_KEY = "fitcoach.userId";

interface SessionValue {
  userId: string | null;
  signIn: (userId: string) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children?: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const signIn = useCallback((id: string) => {
    setUserId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: session state still works in memory */
    }
  }, []);

  const signOut = useCallback(() => {
    setUserId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ userId, signIn, signOut }), [userId, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

export function useAuth() {
  const { userId, signIn, signOut } = useSession();
  return {
    user: userId ? { id: userId } : null,
    signIn,
    signOut,
    isAuthenticated: !!userId,
  };
}
