/**
 * IMMUTABLE contract identifier (TD-119). A threshold/formula change ships as weak-skill-signal-v2.
 * WEAK_SKILL reads ONLY current LearnerSkillState (§4) — never raw attempts/measurements (no duplicate pedagogy).
 */
export const WEAK_SKILL_SIGNAL_VERSION = 'weak-skill-signal-v1';
export const WEAK_SKILL_SIGNAL_TYPE = 'WEAK_SKILL'; // LearnerSignal.type registry value
export const WEAK_SKILL_EVIDENCE_SCHEMA = 'weak-skill-signal/v1';

const ACTIVATE_MASTERY_MAX = 5000; // activate when mastery < 5000 (§5)
const CONFIDENCE_GATE = 7000; // require confidence >= 7000 for both activation and resolution (§5/8)
const EVIDENCE_GATE = 3; // require evidenceCount >= 3 normalized units (§7)
const RESOLVE_MASTERY_MIN = 6500; // resolve at mastery >= 6500 — hysteresis vs 5000 (§8/9)

export type SignalPolicyDecision = 'ACTIVATE' | 'RESOLVE' | 'NO_CHANGE';

export interface WeakSkillStateInput {
  masteryScoreBp: number;
  confidenceBp: number; // caller coerces a null LearnerSkillState.confidenceBp to 0 (fails the gate)
  evidenceCount: number;
}

/**
 * weak-skill-signal-v1 (TD-119). Pure/deterministic. Hysteresis: activate below 5000, resolve at/above 6500;
 * the 5000..6499 band neither creates nor resolves (§9). No CEFR meaning — operational thresholds only.
 */
export function detectWeakSkill(state: WeakSkillStateInput | null, hasActive: boolean): SignalPolicyDecision {
  if (!state) return 'NO_CHANGE'; // no current state → cannot activate; an active signal simply holds
  if (!hasActive) {
    if (state.masteryScoreBp < ACTIVATE_MASTERY_MAX && state.confidenceBp >= CONFIDENCE_GATE && state.evidenceCount >= EVIDENCE_GATE) return 'ACTIVATE';
    return 'NO_CHANGE';
  }
  // Active: resolve only on confident recovery. A confidence drop while active never resolves (§10).
  if (state.masteryScoreBp >= RESOLVE_MASTERY_MIN && state.confidenceBp >= CONFIDENCE_GATE) return 'RESOLVE';
  return 'NO_CHANGE';
}
