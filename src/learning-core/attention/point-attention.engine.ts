/**
 * Pure, versioned Point-Attention derivation (point-attention-v1). No DB / HTTP / clock / AI.
 *
 * Attention is a DERIVED projection over active learner signals + retention policy — never an independent
 * source of truth and never persisted (ROADMAP_ENGINE_V2 §12; MASTERY_REVIEW_ENGINE_V2 §7/§8/§28). It answers
 * "what should this acquired point currently show/do because of active evidence and signals?" while the
 * underlying LearnerSignal / retention policy remain the facts.
 *
 * Hard distinctions preserved (never collapsed):
 *   REPAIR_REQUIRED — established knowledge is now weak / a concrete misconception recurs (REPEATED_MISTAKE or
 *                     WEAK_SKILL signals); routes back through Teaching/remediation, not another quiz.
 *   REVIEW_DUE      — established knowledge is fading (retention/freshness); routes through a recall review.
 * Repair outranks review (a real gap is more urgent than a freshness nudge). Attention is derived only for
 * points the learner has ACQUIRED (LEARNED/VALIDATED); a point still being learned is not "repair"/"review".
 */
export const POINT_ATTENTION_POLICY_VERSION = 'point-attention-v1';

export type PointAttention = 'NONE' | 'REVIEW_DUE' | 'REPAIR_REQUIRED';
/** Learner-facing reason category (mapped to human copy in the UI; engine terms never shown raw). */
export type AttentionReasonCode = 'NONE' | 'REPEATED_MISTAKE' | 'PERSISTENT_WEAKNESS' | 'RETENTION_DUE';

export const REPEATED_MISTAKE_TYPE = 'REPEATED_MISTAKE';
export const WEAK_SKILL_TYPE = 'WEAK_SKILL';
export const REVIEW_DUE_TYPE = 'REVIEW_DUE';

/** One required skill of a point, with its currently-active repair signals and read-time retention state. */
export interface SkillAttentionInput {
  skillId: string;
  activeSignalTypes: string[]; // persisted ACTIVE signals on this skill (REPEATED_MISTAKE / WEAK_SKILL / REVIEW_DUE)
  reviewDue: boolean; // read-time retention: reviewActivation(state, now) fired for this skill
}

export interface PointAttentionResult {
  attention: PointAttention;
  reasonCode: AttentionReasonCode;
  reasonSkillId: string | null; // the skill that drove the attention (for a targeted, honest explanation)
  signalTypes: string[]; // contributing active signal types, for provenance (never shown raw to the learner)
}

const NONE_RESULT: PointAttentionResult = { attention: 'NONE', reasonCode: 'NONE', reasonSkillId: null, signalTypes: [] };

/**
 * Derive a point's attention from its required skills. Precedence:
 *   1. REPAIR_REQUIRED — any required skill has a REPEATED_MISTAKE (misconception pattern; preferred reason,
 *      it yields the clearest learner explanation) or WEAK_SKILL (persistent low competence) active signal.
 *   2. REVIEW_DUE — any required skill is retention-due (read-time policy) or carries a persisted REVIEW_DUE.
 *   3. NONE.
 */
export function derivePointAttention(skills: SkillAttentionInput[]): PointAttentionResult {
  let repairSkill: string | null = null;
  let repairReason: AttentionReasonCode | null = null;
  const repairTypes = new Set<string>();
  for (const s of skills) {
    const hasRepeated = s.activeSignalTypes.includes(REPEATED_MISTAKE_TYPE);
    const hasWeak = s.activeSignalTypes.includes(WEAK_SKILL_TYPE);
    if (hasRepeated) repairTypes.add(REPEATED_MISTAKE_TYPE);
    if (hasWeak) repairTypes.add(WEAK_SKILL_TYPE);
    // Repeated-mistake is the most explainable cause → it takes reason precedence over a bare weak-skill.
    if (hasRepeated && repairReason !== 'REPEATED_MISTAKE') {
      repairReason = 'REPEATED_MISTAKE';
      repairSkill = s.skillId;
    } else if (hasWeak && repairReason === null) {
      repairReason = 'PERSISTENT_WEAKNESS';
      repairSkill = s.skillId;
    }
  }
  if (repairReason !== null) {
    return { attention: 'REPAIR_REQUIRED', reasonCode: repairReason, reasonSkillId: repairSkill, signalTypes: [...repairTypes] };
  }

  const reviewSkill = skills.find((s) => s.reviewDue || s.activeSignalTypes.includes(REVIEW_DUE_TYPE));
  if (reviewSkill) {
    return { attention: 'REVIEW_DUE', reasonCode: 'RETENTION_DUE', reasonSkillId: reviewSkill.skillId, signalTypes: [REVIEW_DUE_TYPE] };
  }
  return NONE_RESULT;
}
