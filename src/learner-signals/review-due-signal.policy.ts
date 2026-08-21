/**
 * IMMUTABLE contract identifier (TD-120). An interval change ships as review-due-signal-v2.
 * REVIEW_DUE uses current LearnerSkillState + Clock.now() (§14) — elapsed time from the logical evidence
 * timestamp, never server/local calendar dates (§16/17). No login/completion/roadmap/plan inputs.
 */
export const REVIEW_DUE_SIGNAL_VERSION = 'review-due-signal-v1';
export const REVIEW_DUE_SIGNAL_TYPE = 'REVIEW_DUE'; // LearnerSignal.type registry value
export const REVIEW_DUE_EVIDENCE_SCHEMA = 'review-due-signal/v1';

const DAY_MS = 24 * 60 * 60 * 1000; // exact 24h duration, not a calendar day

/** review-due-signal-v1 interval (§15): confidence-first, then mastery bands. Returns 1 | 3 | 7 | 14. */
export function reviewIntervalDays(masteryScoreBp: number, confidenceBp: number): number {
  if (confidenceBp < 5000) return 1; // uncertain evidence → quick review
  if (masteryScoreBp < 5000) return 1;
  if (masteryScoreBp < 7000) return 3;
  if (masteryScoreBp < 8500) return 7;
  return 14;
}

export function reviewDueAt(lastMeasurementAt: Date, intervalDays: number): Date {
  return new Date(lastMeasurementAt.getTime() + intervalDays * DAY_MS);
}

export interface ReviewStateInput {
  masteryScoreBp: number;
  confidenceBp: number; // caller coerces null → 0 (→ 1-day interval)
  evidenceCount: number;
  lastMeasurementAt: Date | null;
}

export interface ReviewActivation {
  intervalDays: number;
  dueAt: Date;
  basisLastMeasurementAt: Date;
  masteryScoreBp: number;
  confidenceBp: number;
  evidenceCount: number;
}

/** Activation (§18/50): null unless there is state with evidence + a logical time AND now >= dueAt (inclusive). */
export function reviewActivation(state: ReviewStateInput | null, now: Date): ReviewActivation | null {
  if (!state || state.lastMeasurementAt === null || state.evidenceCount <= 0) return null;
  const intervalDays = reviewIntervalDays(state.masteryScoreBp, state.confidenceBp);
  const dueAt = reviewDueAt(state.lastMeasurementAt, intervalDays);
  if (now.getTime() < dueAt.getTime()) return null; // exact due (==) activates
  return { intervalDays, dueAt, basisLastMeasurementAt: state.lastMeasurementAt, masteryScoreBp: state.masteryScoreBp, confidenceBp: state.confidenceBp, evidenceCount: state.evidenceCount };
}

/** Resolution (§20/52/53): current logical evidence time STRICTLY after the signal basis (mastery need not improve). */
export function reviewResolves(currentLastMeasurementAt: Date | null, basisLastMeasurementAt: Date): boolean {
  return currentLastMeasurementAt !== null && currentLastMeasurementAt.getTime() > basisLastMeasurementAt.getTime();
}

/** Strict basis parser from evidenceRefs (§20/69). Returns null when malformed/missing — never throws. */
export function parseReviewBasis(evidenceRefs: unknown): Date | null {
  if (!evidenceRefs || typeof evidenceRefs !== 'object') return null;
  const r = evidenceRefs as Record<string, unknown>;
  if (r.schemaVersion !== REVIEW_DUE_EVIDENCE_SCHEMA || typeof r.basisLastMeasurementAt !== 'string') return null;
  const d = new Date(r.basisLastMeasurementAt);
  return Number.isNaN(d.getTime()) ? null : d;
}
