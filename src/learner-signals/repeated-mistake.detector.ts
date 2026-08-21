/**
 * IMMUTABLE detector contract identifier (TD-116). A future rule change (trigger count, distinct-Activity
 * semantics, recovery rule, evidence source) ships as repeated-mistake-signal-v2 — never a silent v1 change.
 */
export const REPEATED_MISTAKE_SIGNAL_VERSION = 'repeated-mistake-signal-v1';
export const REPEATED_MISTAKE_SIGNAL_TYPE = 'REPEATED_MISTAKE'; // LearnerSignal.type is a String registry
export const REPEATED_MISTAKE_EVIDENCE_SCHEMA = 'repeated-mistake-signal/v1';

const TRIGGER_COUNT = 3; // three most-recent DISTINCT Activity outcomes all incorrect → activate
const RECOVERY_COUNT = 2; // two most-recent DISTINCT Activity outcomes all correct → resolve

/** One current outcome per DISTINCT Activity (retries already collapsed), most-recent-first (§10/23). */
export interface ActivityOutcome {
  activityId: string;
  activityAttemptId: string;
  isCorrect: boolean;
}

export type SignalDecision =
  | { action: 'NO_CHANGE' }
  | { action: 'ACTIVATE'; triggerActivityIds: string[]; triggerAttemptIds: string[] }
  | { action: 'RESOLVE' };

/**
 * repeated-mistake-signal-v1 (TD-116). Pure/deterministic — no I/O, no clock, no answers.
 * `outcomes` MUST be the latest distinct-Activity outcomes for one (user, skill), ordered most-recent-first.
 */
export function detectRepeatedMistake(outcomes: ActivityOutcome[], hasActiveSignal: boolean): SignalDecision {
  if (!hasActiveSignal) {
    // Trigger: the 3 most-recent distinct Activity outcomes are all incorrect (≥3 distinct required, §12).
    if (outcomes.length >= TRIGGER_COUNT && outcomes.slice(0, TRIGGER_COUNT).every((o) => !o.isCorrect)) {
      const trigger = outcomes.slice(0, TRIGGER_COUNT);
      return { action: 'ACTIVATE', triggerActivityIds: trigger.map((o) => o.activityId), triggerAttemptIds: trigger.map((o) => o.activityAttemptId) };
    }
    return { action: 'NO_CHANGE' };
  }
  // Recovery: the 2 most-recent distinct Activity outcomes are all correct (§13). No mastery threshold.
  if (outcomes.length >= RECOVERY_COUNT && outcomes.slice(0, RECOVERY_COUNT).every((o) => o.isCorrect)) {
    return { action: 'RESOLVE' };
  }
  return { action: 'NO_CHANGE' };
}

/** Strict parser for repeated-mistake evidenceRefs → trigger Activity ids (consumed by review-candidate-v1
 *  direct-trigger provenance, 1.9A §14/46). Malformed/missing → [] (never throws, no internal leak). */
export function parseTriggerActivityIds(evidenceRefs: unknown): string[] {
  if (!evidenceRefs || typeof evidenceRefs !== 'object') return [];
  const r = evidenceRefs as Record<string, unknown>;
  if (r.schemaVersion !== REPEATED_MISTAKE_EVIDENCE_SCHEMA) return [];
  const ids = r.triggerActivityIds;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return [];
  return ids as string[];
}

/** Collapse eligible attempts (already ordered most-recent-first) to one latest outcome per Activity (§10). */
export function collapseLatestPerActivity(attempts: (ActivityOutcome & { activityId: string })[]): ActivityOutcome[] {
  const seen = new Set<string>();
  const out: ActivityOutcome[] = [];
  for (const a of attempts) {
    if (seen.has(a.activityId)) continue;
    seen.add(a.activityId);
    out.push({ activityId: a.activityId, activityAttemptId: a.activityAttemptId, isCorrect: a.isCorrect });
  }
  return out;
}
