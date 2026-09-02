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

/** One MASTERY_TEST activity's best score + its HONEST evidence descriptor (from its format) + attributed skills. */
export interface MasteryActivityInput {
  activityId: string;
  bestScoreBp: number; // 0..10000
  evidenceKind: string; // recognition | controlled-production | listening-comprehension
  independenceLevel: number; // 1 recognition/listening · 2 controlled-production
  skillIds: string[];
}

export interface TeachingMasteryEntry {
  skillId: string;
  scoreBp: number; // 0..10000 (mean of best scores)
  confidenceBp: number; // 10000 (complete coverage)
  evidenceCount: number; // distinct mastery activities attributed to the skill
  evidenceKind: string; // the kind of the highest-independence contributing activity (honest, not fabricated)
  independenceLevel: number; // MAX independence among the skill's mastery activities — the gate lever
}

/**
 * Derive one per-skill mastery entry. Score = mean of best scores; independenceLevel = MAX among the skill's mastery
 * activities (so a skill proven with structured production reaches level 2; recognition-only stays level 1);
 * evidenceKind = the kind of that highest-independence activity. Deterministic; no fabricated evidence.
 */
export function deriveTeachingMastery(inputs: MasteryActivityInput[]): TeachingMasteryEntry[] {
  const bySkill = new Map<string, { scores: number[]; bestIndep: number; kindAtBest: string }>();
  for (const input of inputs) {
    for (const skillId of new Set(input.skillIds)) {
      const agg = bySkill.get(skillId) ?? bySkill.set(skillId, { scores: [], bestIndep: -1, kindAtBest: input.evidenceKind }).get(skillId)!;
      agg.scores.push(input.bestScoreBp);
      if (input.independenceLevel > agg.bestIndep) { agg.bestIndep = input.independenceLevel; agg.kindAtBest = input.evidenceKind; }
    }
  }
  const out: TeachingMasteryEntry[] = [];
  for (const [skillId, agg] of bySkill) {
    if (agg.scores.length === 0) continue;
    const mean = agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length;
    out.push({ skillId, scoreBp: clampBp(Math.round(mean)), confidenceBp: 10000, evidenceCount: agg.scores.length, evidenceKind: agg.kindAtBest, independenceLevel: agg.bestIndep });
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
    // Independence is PER SKILL now — recognition-only evidence (level 1) cannot satisfy a controlled-production
    // gate (minIndependence 2), so a point can honestly REQUIRE structured production.
    let passed = true;
    let reason: SkillGateResult['reason'] = 'passed';
    if (e.independenceLevel < gates.minIndependence) {
      passed = false;
      reason = 'below_independence';
    } else if (e.scoreBp < gates.thresholdBp) {
      passed = false;
      reason = 'below_threshold';
    }
    if (!passed) allPassed = false;
    gateResults.push({ skillId, scoreBp: e.scoreBp, evidenceCount: e.evidenceCount, independenceLevel: e.independenceLevel, passed, reason });
  }

  const outcome: MasteryOutcome = anyMissing ? 'INSUFFICIENT_EVIDENCE' : allPassed ? 'SATISFIED' : 'NOT_SATISFIED';
  return { outcome, gates: gateResults };
}

function clampBp(v: number): number {
  return Math.max(0, Math.min(10000, v));
}
