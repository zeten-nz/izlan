/**
 * Pure V2 teaching-mastery derivation + gate evaluation (teaching-mastery-v1). No DB / HTTP / AI.
 *
 * Mirrors lesson-mastery-v1 discipline: uses ONLY MASTERY_TEST evidence, best deterministic attempt per
 * activity, attributed via ActivitySkill. Per skill: arithmetic mean of best scores; confidence = complete
 * coverage = 10000; evidenceCount = distinct mastery activities. The engine is signal/state-unaware — the
 * caller appends the measurements and calls LearningProgressService for the authoritative LearnerSkillState.
 *
 * Evaluation compares the exact per-skill evidence produced in ONE teaching session against the point's
 * MasteryRequirement gates. MASTERY_TEST evidence is independent production, so independenceLevel is fixed.
 */
export const TEACHING_MASTERY_DERIVATION_VERSION = 'teaching-mastery-v1';
export const TEACHING_MASTERY_EVALUATION_POLICY = 'teaching-mastery-eval-v1';
/** MASTERY_TEST activities are attempted independently → level 2 on the guided(0)/scaffolded(1)/independent(2) ordinal. */
export const TEACHING_MASTERY_INDEPENDENCE_LEVEL = 2;
export const TEACHING_MASTERY_EVIDENCE_KIND = 'free-production';

/** One MASTERY_TEST activity's best score in the session + the skills it is attributed to (subject-scoped). */
export interface MasteryActivityInput {
  activityId: string;
  bestScoreBp: number; // 0..10000
  skillIds: string[];
}

export interface TeachingMasteryEntry {
  skillId: string;
  scoreBp: number; // 0..10000 (mean of best scores)
  confidenceBp: number; // 10000 (complete coverage)
  evidenceCount: number; // distinct mastery activities attributed to the skill
}

/** Derive one per-skill mastery entry from the session's mastery-activity best scores. Deterministic. */
export function deriveTeachingMastery(inputs: MasteryActivityInput[]): TeachingMasteryEntry[] {
  const bySkill = new Map<string, number[]>();
  for (const input of inputs) {
    for (const skillId of new Set(input.skillIds)) {
      const arr = bySkill.get(skillId) ?? bySkill.set(skillId, []).get(skillId)!;
      arr.push(input.bestScoreBp);
    }
  }
  const out: TeachingMasteryEntry[] = [];
  for (const [skillId, scores] of bySkill) {
    if (scores.length === 0) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    out.push({ skillId, scoreBp: clampBp(Math.round(mean)), confidenceBp: 10000, evidenceCount: scores.length });
  }
  return out.sort((a, b) => (a.skillId < b.skillId ? -1 : 1));
}

export interface MasteryGates {
  thresholdBp: number;
  minIndependence: number;
}

export type MasteryOutcome = 'SATISFIED' | 'NOT_SATISFIED' | 'INSUFFICIENT_EVIDENCE';

export interface SkillGateResult {
  skillId: string;
  scoreBp: number | null; // null → no evidence for this required skill
  evidenceCount: number;
  independenceLevel: number | null;
  passed: boolean;
  reason: 'passed' | 'no_evidence' | 'below_threshold' | 'below_independence';
}

export interface MasteryEvaluationResult {
  outcome: MasteryOutcome;
  gates: SkillGateResult[];
}

/**
 * Evaluate the session's exact evidence against the gates. INSUFFICIENT_EVIDENCE iff any required skill has
 * NO evidence; else SATISFIED iff every required skill passes threshold + independence; else NOT_SATISFIED.
 */
export function evaluateTeachingMastery(
  requiredSkillIds: string[],
  entries: TeachingMasteryEntry[],
  independenceLevel: number,
  gates: MasteryGates,
): MasteryEvaluationResult {
  const byId = new Map(entries.map((e) => [e.skillId, e]));
  const gateResults: SkillGateResult[] = [];
  let anyMissing = false;
  let allPassed = true;

  for (const skillId of [...new Set(requiredSkillIds)].sort()) {
    const e = byId.get(skillId);
    if (!e) {
      anyMissing = true;
      allPassed = false;
      gateResults.push({ skillId, scoreBp: null, evidenceCount: 0, independenceLevel: null, passed: false, reason: 'no_evidence' });
      continue;
    }
    let passed = true;
    let reason: SkillGateResult['reason'] = 'passed';
    if (independenceLevel < gates.minIndependence) {
      passed = false;
      reason = 'below_independence';
    } else if (e.scoreBp < gates.thresholdBp) {
      passed = false;
      reason = 'below_threshold';
    }
    if (!passed) allPassed = false;
    gateResults.push({ skillId, scoreBp: e.scoreBp, evidenceCount: e.evidenceCount, independenceLevel, passed, reason });
  }

  const outcome: MasteryOutcome = anyMissing ? 'INSUFFICIENT_EVIDENCE' : allPassed ? 'SATISFIED' : 'NOT_SATISFIED';
  return { outcome, gates: gateResults };
}

function clampBp(v: number): number {
  return Math.max(0, Math.min(10000, v));
}
