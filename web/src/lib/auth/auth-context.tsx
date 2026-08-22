'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { refreshAccessToken } from '../api/client';
import { fetchMe, logout as logoutApi } from '../api/auth';
import { clearAccessToken } from './token-store';
import type { AuthUser } from '../api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Called by the login flow after a successful OTP verify (access token already in memory). */
  setAuthenticatedUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth bootstrap (§7): a browser reload loses the in-memory access token by design. On mount we attempt ONE
 * single-flight refresh (HttpOnly cookie), then GET /me. Only after that completes do we decide authenticated vs
 * unauthenticated — a missing token before bootstrap is NOT treated as logged out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (!token) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      try {
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearAccessToken();
        setUser(null);
        setStatus('unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAuthenticatedUser = useCallback((u: AuthUser) => {
    setUser(u);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(() => ({ status, user, setAuthenticatedUser, logout }), [status, user, setAuthenticatedUser, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
