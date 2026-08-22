'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Revision } from '../api/types';

/**
 * ONE Revision.updatedAt token authority for the whole revision editor (§31/32, merge-blocker).
 *
 * Every mutation that returns a new `revisionUpdatedAt` (activity create/patch/delete, reorder, ActivitySkill
 * add/remove) MUST call `setRevisionToken(...)` here, and every mutation that needs `expectedRevisionUpdatedAt` MUST
 * read `revision.updatedAt` from here. No child component caches its own copy — that would cause false 409s / stale
 * writes. The full revision object is also held so lifecycle state (DRAFT/REVIEW/...) is shared consistently.
 */
interface RevisionEditorContextValue {
  revision: Revision;
  /** Advance ONLY the OCC token (from a mutation that returned a fresh revisionUpdatedAt). */
  setRevisionToken: (updatedAt: string) => void;
  /** Replace the whole revision (after PATCH / workflow transition / reload from server). */
  setRevision: (r: Revision) => void;
}

const RevisionEditorContext = createContext<RevisionEditorContextValue | null>(null);

export function RevisionEditorProvider({ initial, children }: { initial: Revision; children: ReactNode }) {
  const [revision, setRevisionState] = useState<Revision>(initial);

  const setRevisionToken = useCallback((updatedAt: string) => {
    setRevisionState((prev) => (updatedAt === prev.updatedAt ? prev : { ...prev, updatedAt }));
  }, []);
  const setRevision = useCallback((r: Revision) => setRevisionState(r), []);

  const value = useMemo(() => ({ revision, setRevisionToken, setRevision }), [revision, setRevisionToken, setRevision]);
  return <RevisionEditorContext.Provider value={value}>{children}</RevisionEditorContext.Provider>;
}

export function useRevisionEditor(): RevisionEditorContextValue {
  const ctx = useContext(RevisionEditorContext);
  if (!ctx) throw new Error('useRevisionEditor must be used within RevisionEditorProvider');
  return ctx;
}
