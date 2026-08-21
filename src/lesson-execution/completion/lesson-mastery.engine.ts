/**
 * Pure lesson-mastery derivation (lesson-mastery-v1, TD-111). No DB/HTTP/AI. Uses ONLY MASTERY_TEST
 * evidence (§18), best deterministic attempt per activity (§20), attributed via ActivitySkill (LessonSkill
 * fallback resolved by the caller, §24/25). Per Skill: arithmetic mean of best scores (§27); confidence is
 * complete evidence coverage = 10000 (§29); evidenceCount = distinct mastery activities (§30); level = null.
 */
export const LESSON_MASTERY_DERIVATION_VERSION = 'lesson-mastery-v1';

/** One MASTERY_TEST activity's best score + the skills it is attributed to (already subject-scoped). */
export interface MasteryActivityInput {
  activityId: string;
  bestScoreBp: number; // 0..10000
  skillIds: string[];
}

export interface SkillMasteryEntry {
  skillId: string;
  scoreBp: number; // 0..10000
  confidenceBp: number; // 10000
  evidenceCount: number; // distinct mastery activities attributed to the skill
}

export function deriveLessonMastery(inputs: MasteryActivityInput[]): SkillMasteryEntry[] {
  const bySkill = new Map<string, number[]>(); // skillId → best scores (one per distinct mastery activity)
  for (const input of inputs) {
    for (const skillId of new Set(input.skillIds)) {
      const arr = bySkill.get(skillId) ?? bySkill.set(skillId, []).get(skillId)!;
      arr.push(input.bestScoreBp);
    }
  }
  const out: SkillMasteryEntry[] = [];
  for (const [skillId, scores] of bySkill) {
    if (scores.length === 0) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    out.push({ skillId, scoreBp: clampBp(Math.round(mean)), confidenceBp: 10000, evidenceCount: scores.length });
  }
  return out.sort((a, b) => (a.skillId < b.skillId ? -1 : 1)); // deterministic
}

function clampBp(v: number): number {
  return Math.max(0, Math.min(10000, v));
}
