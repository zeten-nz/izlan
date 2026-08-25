import { apiRequest } from './client';
import { isNotFound } from './errors';
import type { DiagnosticSnapshot, SkillProfileView } from './types';

/**
 * Skill Profile API (Phase 02B result). Learner state is backend-derived — the client never computes mastery.
 */

/** GET /api/skill-profile/diagnostics/:attemptId — the derived diagnostic milestone snapshot (409 if not yet derived). */
export function getDiagnosticSnapshot(attemptId: string): Promise<DiagnosticSnapshot> {
  return apiRequest<DiagnosticSnapshot>(`/api/skill-profile/diagnostics/${attemptId}`);
}

/**
 * GET /api/skill-profile/me/subjects/:subjectId — the current backend-derived skill state (mastery / confidence /
 * evidence) for one subject (Phase 05 Progress). A subject with no measured skills yet is a calm EMPTY state, not an
 * error: a 404 is mapped to an empty skills list (keeping the subject title from the caller) so the page can distinguish
 * "no evidence yet" from a network/auth failure. The client never computes or infers mastery — it only reads.
 */
export async function getCurrentSkillProfile(subjectId: string, subjectTitle = ''): Promise<SkillProfileView> {
  try {
    return await apiRequest<SkillProfileView>(`/api/skill-profile/me/subjects/${subjectId}`);
  } catch (e) {
    if (isNotFound(e)) return { subject: { id: subjectId, title: subjectTitle }, skills: [] };
    throw e;
  }
}

/** POST /api/skill-profile/diagnostics/:attemptId/derive — idempotent repair/backfill; returns the snapshot. */
export function deriveDiagnostic(attemptId: string): Promise<DiagnosticSnapshot> {
  return apiRequest<DiagnosticSnapshot>(`/api/skill-profile/diagnostics/${attemptId}/derive`, { method: 'POST' });
}
