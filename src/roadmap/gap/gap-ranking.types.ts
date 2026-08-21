/**
 * roadmap-gap-v1 (TD-99) — deterministic gap RANKING contract. Ranking-only: NOT mastery, NOT CEFR,
 * NOT a pass/fail threshold, NOT a weak/strong label, NOT a statistical probability. Ranks the exact
 * diagnostic SkillMeasurement snapshot; no thresholds — every evidence-backed measured Skill participates.
 */
export const ROADMAP_GAP_VERSION = 'roadmap-gap-v1';

/** One measured Skill from the exact diagnostic snapshot (SkillMeasurement + reproducible evidence count). */
export interface MeasuredSkill {
  skillId: string;
  masteryScoreBp: number; // 0..10000
  confidenceBp: number; // 0..10000
  evidenceCount: number; // SUBMITTED objective responses for the skill in this attempt
}

export interface RankedGap {
  skillId: string;
  gapPriorityBp: number; // 0..10000 — priority rank only
  masteryScoreBp: number;
  confidenceBp: number;
  evidenceCount: number;
}
