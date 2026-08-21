import { Injectable } from '@nestjs/common';
import {
  PLACEMENT_ENGINE_STATE_SCHEMA_VERSION,
  PLACEMENT_ENGINE_VERSION,
  PlacementConfig,
  PlacementEngineState,
  PoolItem,
  SkillState,
} from './placement-engine.types';

/**
 * Deterministic, SKILL-BALANCED placement engine (§10/15/16/17/18/19). Pure/stateless — given the
 * same (config, engineState, pinned pool) it always yields the same decision. NO Math.random, NO
 * wall-clock, NO external item lookup — selection is confined to the pinned pool passed in by the
 * caller (which reads AssessmentVersionItem membership). Each Skill carries its OWN adaptive target,
 * so one Skill's answer never moves another Skill's difficulty.
 */
@Injectable()
export class PlacementEngineService {
  /** Distinct skills come from the EXACT pinned pool (not the Subject skill catalog, §16). */
  initialState(config: PlacementConfig, pool: PoolItem[]): PlacementEngineState {
    const skills: Record<string, SkillState> = {};
    for (const p of pool) {
      if (!skills[p.skillId]) skills[p.skillId] = { targetDifficulty: config.selection.startDifficulty, answeredCount: 0 };
    }
    return {
      schemaVersion: PLACEMENT_ENGINE_STATE_SCHEMA_VERSION,
      engineVersion: PLACEMENT_ENGINE_VERSION,
      presentedItemIds: [],
      answeredCount: 0,
      skills,
    };
  }

  /** Distinct skillIds represented by the pinned pool (used for coverage/feasibility, §16/19). */
  distinctSkillIds(pool: PoolItem[]): string[] {
    return [...new Set(pool.map((p) => p.skillId))];
  }

  /**
   * Skill-balanced next-item selection (§17):
   *  1. exclude already-presented items (no repeats);
   *  2. candidate skills = those with an unseen eligible item AND answeredCount < itemsPerSkill;
   *  3. pick the skill with the lowest answeredCount (tie-break: skillId ascending);
   *  4. inside it, pick the unseen item nearest that skill's targetDifficulty
   *     (tie-break: smaller |distance|, then lower difficulty, then itemId ascending).
   * Returns null when no such item exists (coverage met for pickable skills / pool exhausted).
   */
  pickItem(config: PlacementConfig, state: PlacementEngineState, pool: PoolItem[]): string | null {
    const seen = new Set(state.presentedItemIds);
    const eligible = pool.filter((p) => !seen.has(p.itemId));
    if (eligible.length === 0) return null;

    // Skills that still need evidence AND have an unseen item.
    const skillsWithEligible = new Set(eligible.map((p) => p.skillId));
    const candidateSkills = [...skillsWithEligible].filter((sid) => (state.skills[sid]?.answeredCount ?? 0) < config.coverage.itemsPerSkill);
    if (candidateSkills.length === 0) return null;

    candidateSkills.sort((a, b) => {
      const ca = state.skills[a]?.answeredCount ?? 0;
      const cb = state.skills[b]?.answeredCount ?? 0;
      if (ca !== cb) return ca - cb; // lowest answeredCount first
      return a < b ? -1 : 1; // deterministic tie-break: skillId ascending
    });
    const skillId = candidateSkills[0];
    const target = state.skills[skillId]?.targetDifficulty ?? config.selection.startDifficulty;

    const within = eligible.filter((p) => p.skillId === skillId);
    let best = within[0];
    let bestDist = Math.abs(best.difficulty - target);
    for (const cand of within.slice(1)) {
      const dist = Math.abs(cand.difficulty - target);
      if (
        dist < bestDist ||
        (dist === bestDist && cand.difficulty < best.difficulty) ||
        (dist === bestDist && cand.difficulty === best.difficulty && cand.itemId < best.itemId)
      ) {
        best = cand;
        bestDist = dist;
      }
    }
    return best.itemId;
  }

  /** Mark an item as presented (immutably returns the next state). */
  markPresented(state: PlacementEngineState, itemId: string): PlacementEngineState {
    return { ...state, presentedItemIds: [...state.presentedItemIds, itemId] };
  }

  /**
   * Fold one answered objective item into ONLY its Skill's state (§18). Correct → target+stepUp,
   * incorrect → max(1, target−stepDown). Other skills are untouched.
   */
  applyResult(config: PlacementConfig, state: PlacementEngineState, skillId: string, isCorrect: boolean): PlacementEngineState {
    const prev = state.skills[skillId] ?? { targetDifficulty: config.selection.startDifficulty, answeredCount: 0 };
    const targetDifficulty = isCorrect ? prev.targetDifficulty + config.selection.stepUp : Math.max(1, prev.targetDifficulty - config.selection.stepDown);
    return {
      ...state,
      answeredCount: state.answeredCount + 1,
      skills: { ...state.skills, [skillId]: { targetDifficulty, answeredCount: prev.answeredCount + 1 } },
    };
  }

  /** Terminal when the safety cap is hit, or nothing useful remains to present (§19). */
  isComplete(config: PlacementConfig, state: PlacementEngineState, pool: PoolItem[]): boolean {
    if (state.answeredCount >= config.stopping.maxItems) return true;
    return this.pickItem(config, state, pool) === null;
  }

  /** Coverage report for the result summary (§20): skills that never met their quota. */
  coverage(config: PlacementConfig, state: PlacementEngineState, pool: PoolItem[]): { complete: boolean; insufficientSkillIds: string[] } {
    const insufficientSkillIds = this.distinctSkillIds(pool)
      .filter((sid) => (state.skills[sid]?.answeredCount ?? 0) < config.coverage.itemsPerSkill)
      .sort((a, b) => (a < b ? -1 : 1));
    return { complete: insufficientSkillIds.length === 0, insufficientSkillIds };
  }
}
