import { Injectable } from '@nestjs/common';
import { PlacementConfig, PoolItem } from '../../assessment/engine/placement-engine.types';
import { DiagnosticResponse, SkillProfileEntry } from './diagnostic-profile.types';

/**
 * Pure, deterministic diagnostic Skill Profile derivation (§26). No DB, no HTTP, no Prisma, no AI.
 * Reproducible from immutable evidence only: (pinned config, exact pool, ordered submitted responses).
 *
 * MASTERY is DIFFICULTY-AWARE, not raw accuracy (§9/10/45). The accepted placement-adaptive-v1 selection
 * target is a net-correctness walk (difficulty-INSENSITIVE, locked by 1.5B tests), so mastery is derived
 * here from the DIFFICULTIES of answered items weighted by correctness — a learner who succeeds at harder
 * items scores higher than one who only succeeds at easier items, even at equal accuracy.
 *
 * FROZEN v1 contract (TD-97 — never change under this derivationVersion, Phase 1.5C-2 §3/5):
 *   per response with effective item difficulty d:
 *     correct   → e = d
 *     incorrect → e = d − 1   (the PREVIOUS ordinal evidence band — NOT config.selection.stepDown,
 *                              which is a next-item selection concern; distinct semantics, §4)
 *   e = clamp(e, profileScale.minDifficulty, profileScale.maxDifficulty)
 *   estimatedDifficulty(skill) = arithmetic mean of the skill's per-response estimates
 * CONFIDENCE is evidence coverage, not statistical certainty (§12).
 */
@Injectable()
export class DiagnosticSkillProfileEngine {
  derive(config: PlacementConfig, pool: PoolItem[], orderedResponses: DiagnosticResponse[]): SkillProfileEntry[] {
    const { minDifficulty, maxDifficulty } = config.profileScale;
    const item = new Map(pool.map((p) => [p.itemId, p]));

    const bySkill = new Map<string, number[]>(); // skillId → per-response difficulty estimates
    for (const r of orderedResponses) {
      const meta = item.get(r.itemId);
      if (!meta) continue; // response item not in the pinned pool — caller validates scope
      const raw = r.isCorrect ? meta.difficulty : meta.difficulty - 1; // -1 = previous ordinal band (§4)
      const estimate = Math.max(minDifficulty, Math.min(maxDifficulty, raw)); // clamp to profileScale (§3)
      const acc = bySkill.get(meta.skillId) ?? [];
      acc.push(estimate);
      bySkill.set(meta.skillId, acc);
    }

    const out: SkillProfileEntry[] = [];
    for (const [skillId, estimates] of bySkill) {
      if (estimates.length === 0) continue; // §22 zero evidence → no measurement
      const estimatedDifficulty = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      out.push({
        skillId,
        estimatedDifficulty,
        masteryScoreBp: normalizeMasteryBp(estimatedDifficulty, minDifficulty, maxDifficulty),
        confidenceBp: coverageConfidenceBp(estimates.length, config.coverage.itemsPerSkill),
        evidenceCount: estimates.length,
      });
    }
    return out.sort((a, b) => (a.skillId < b.skillId ? -1 : 1)); // deterministic (§33)
  }
}

/** Normalize an ordinal difficulty onto 0..10000 basis points over the pinned profileScale (§9/44). */
export function normalizeMasteryBp(estimatedDifficulty: number, minDifficulty: number, maxDifficulty: number): number {
  const clamped = Math.max(minDifficulty, Math.min(maxDifficulty, estimatedDifficulty));
  const bp = Math.round(((clamped - minDifficulty) / (maxDifficulty - minDifficulty)) * 10000);
  return Math.max(0, Math.min(10000, bp)); // integer, single rounding (§42)
}

/** Coverage-based confidence: evidence / target quota, capped at full (§12/47). */
export function coverageConfidenceBp(evidenceCount: number, itemsPerSkill: number): number {
  const bp = Math.round(Math.min(1, evidenceCount / itemsPerSkill) * 10000);
  return Math.max(0, Math.min(10000, bp));
}
