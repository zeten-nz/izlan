/**
 * skill-profile-diagnostic-v1 — accepted derivation contract (TD-97). Converts immutable
 * placement-adaptive-v1 diagnostic evidence into normalized per-Skill state.
 *
 * NOT CEFR / IRT / final psychometric truth. It is the deterministic MVP rule. Methodist owns item
 * calibration, config values, future confidence/proficiency mapping. Changing the math later ⇒ a new
 * version constant (never silently change v1 under the same string).
 */
export const SKILL_PROFILE_DIAGNOSTIC_VERSION = 'skill-profile-diagnostic-v1';

/** One immutable objective response used as evidence (from AssessmentResponse, SUBMITTED). */
export interface DiagnosticResponse {
  itemId: string;
  isCorrect: boolean;
}

/** Per-Skill derived profile (mastery/confidence in basis points, TD-89). */
export interface SkillProfileEntry {
  skillId: string;
  estimatedDifficulty: number; // internal (float) — NOT persisted; only masteryScoreBp is stored
  masteryScoreBp: number; // 0..10000
  confidenceBp: number; // 0..10000
  evidenceCount: number;
}
