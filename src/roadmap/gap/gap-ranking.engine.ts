import { Injectable } from '@nestjs/common';
import { MeasuredSkill, RankedGap } from './gap-ranking.types';

/**
 * Pure deterministic gap ranking (TD-99, §3/6). No DB, no HTTP, no AI.
 *
 *   weaknessBp     = 10000 − masteryScoreBp
 *   gapPriorityBp  = round(weaknessBp × confidenceBp / 10000)   (clamped 0..10000)
 *
 * Confidence is included so a confidently-identified gap outranks a weak-looking-but-low-evidence one
 * (§4). It is a PRIORITY rank only — no threshold, no label (§5). Every measured skill participates.
 */
@Injectable()
export class GapRankingEngine {
  rank(measured: MeasuredSkill[]): RankedGap[] {
    const gaps = measured.map((m) => {
      const mastery = clampBp(m.masteryScoreBp);
      const confidence = clampBp(m.confidenceBp);
      const weakness = 10000 - mastery;
      const gapPriorityBp = clampBp(Math.round((weakness * confidence) / 10000));
      return { skillId: m.skillId, gapPriorityBp, masteryScoreBp: mastery, confidenceBp: confidence, evidenceCount: m.evidenceCount };
    });
    // Deterministic order (§6): gapPriority DESC, mastery ASC, confidence DESC, evidence DESC, skillId ASC.
    return gaps.sort(
      (a, b) =>
        b.gapPriorityBp - a.gapPriorityBp ||
        a.masteryScoreBp - b.masteryScoreBp ||
        b.confidenceBp - a.confidenceBp ||
        b.evidenceCount - a.evidenceCount ||
        (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0),
    );
  }
}

function clampBp(v: number): number {
  if (!Number.isFinite(v)) return 0; // guard invalid input (§40)
  return Math.max(0, Math.min(10000, Math.round(v)));
}
