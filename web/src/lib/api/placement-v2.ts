import { apiRequest } from './client';

/**
 * Placement V2 API wrappers. The server is the sole authority for the immutable PlacementDecision, its validation
 * lineage and the personalized roadmap projection — the client only renders the decision-time snapshot it returns.
 * Thresholds/policy live server-side (versioned); the UI never re-derives a level or invents a band. "Not assessed"
 * is a distinct state from a 0% score, and answer keys / raw evidence are never sent or received.
 */

export type PointOutcome = 'VALIDATED' | 'WEAK' | 'AVAILABLE' | 'UNASSESSED';

export interface PlacementDomainView {
  code: string;
  name: string;
  state: 'MEASURED' | 'NOT_ASSESSED';
  bandBp: number | null; // null when NOT_ASSESSED — never rendered as 0%
}

export interface PlacementPointView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  outcome: PointOutcome;
  bandBp: number | null;
}

export interface PlacementResultView {
  decisionId: string;
  decisionType: string;
  entryIntent: 'NEW' | 'CLAIMS_LEVEL';
  claimedLevel: string | null;
  demonstratedLevel: string | null;
  overallBp: number | null;
  recommendedStart: { roadmapPointId: string; title: string } | null;
  domains: PlacementDomainView[];
  points: PlacementPointView[];
  summary: { validatedCount: number; weakCount: number; availableCount: number; unassessedCount: number };
  policyVersion: string;
}

/** NEW learner ("starting from zero"): no diagnostic — an immutable FRESH_START decision + full available roadmap. */
export function startFromZero(subjectId: string, clientRequestId: string): Promise<PlacementResultView> {
  return apiRequest(`/api/v2/placement/subjects/${subjectId}/from-zero`, { method: 'POST', body: { clientRequestId } });
}

/** Experienced learner: finalize a COMPLETED diagnostic attempt into the immutable placement decision + roadmap. */
export function finalizeDiagnostic(attemptId: string): Promise<PlacementResultView> {
  return apiRequest(`/api/v2/placement/diagnostics/${attemptId}/finalize`, { method: 'POST' });
}

/** The learner's latest placement decision for a subject (decision-time snapshot), or null if none yet. */
export function getPlacementResult(subjectId: string): Promise<PlacementResultView | null> {
  return apiRequest(`/api/v2/placement/me/subjects/${subjectId}`);
}
