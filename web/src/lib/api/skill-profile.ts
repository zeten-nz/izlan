import { apiRequest } from './client';
import type { DiagnosticSnapshot } from './types';

/**
 * Skill Profile API (Phase 02B result). Learner state is backend-derived — the client never computes mastery.
 */

/** GET /api/skill-profile/diagnostics/:attemptId — the derived diagnostic milestone snapshot (409 if not yet derived). */
export function getDiagnosticSnapshot(attemptId: string): Promise<DiagnosticSnapshot> {
  return apiRequest<DiagnosticSnapshot>(`/api/skill-profile/diagnostics/${attemptId}`);
}

/** POST /api/skill-profile/diagnostics/:attemptId/derive — idempotent repair/backfill; returns the snapshot. */
export function deriveDiagnostic(attemptId: string): Promise<DiagnosticSnapshot> {
  return apiRequest<DiagnosticSnapshot>(`/api/skill-profile/diagnostics/${attemptId}/derive`, { method: 'POST' });
}
