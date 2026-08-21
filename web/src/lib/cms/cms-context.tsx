'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchCmsSession } from '../api/auth';
import { isForbidden } from '../api/errors';
import type { CmsCapabilities, CmsSession } from '../api/types';

export type CmsStatus = 'loading' | 'ready' | 'forbidden' | 'error';

interface CmsContextValue {
  status: CmsStatus;
  session: CmsSession | null;
  capabilities: CmsCapabilities;
  reload: () => void;
}

const NO_CAPS: CmsCapabilities = { author: false, publish: false, subjectManage: false };
const CmsContext = createContext<CmsContextValue | null>(null);

/**
 * CMS access bootstrap (§11): after auth, GET /api/staff/content/session. 403 → a clean "access unavailable" screen
 * (we do NOT infer roles from 403). The capability booleans drive UX visibility ONLY — the backend remains the final
 * authorization authority for every mutation.
 */
export function CmsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CmsStatus>('loading');
  const [session, setSession] = useState<CmsSession | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const s = await fetchCmsSession();
        if (cancelled) return;
        setSession(s);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setSession(null);
        setStatus(isForbidden(e) ? 'forbidden' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const capabilities = session?.capabilities ?? NO_CAPS;
  const value = useMemo(() => ({ status, session, capabilities, reload }), [status, session, capabilities, reload]);
  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>;
}

export function useCms(): CmsContextValue {
  const ctx = useContext(CmsContext);
  if (!ctx) throw new Error('useCms must be used within CmsProvider');
  return ctx;
}

export function useCapabilities(): CmsCapabilities {
  return useCms().capabilities;
}
