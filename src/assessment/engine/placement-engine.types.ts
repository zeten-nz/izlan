/**
 * Placement (initial diagnostic) engine — accepted implementation engine contract (TD-96).
 *
 * `placement-adaptive-v1` provides deterministic, SKILL-BALANCED mechanics for OBJECTIVE items only.
 * It is NOT a psychometric/IRT model and defines NO CEFR thresholds. The human methodist owns item
 * calibration, config parameter VALUES, and future confidence algorithms (TD-96 clarification).
 * `difficulty` is a subject-neutral ordinal integer used purely as an adaptive target (no global
 * CEFR mapping, no fixed upper bound). Config authority = AssessmentDefinitionVersion.config
 * (per-version, immutable after publish) — never global constants.
 */

// Stable engine identifier persisted on every attempt (AssessmentAttempt.engineVersion).
export const PLACEMENT_ENGINE_VERSION = 'placement-adaptive-v1';

// schema_version markers for the governed JSONB blobs (TD-92 / JSONB_GOVERNANCE).
export const PLACEMENT_CONFIG_SCHEMA_VERSION = 'placement-adaptive/v1';
export const PLACEMENT_ENGINE_STATE_SCHEMA_VERSION = 'placement-engine-state/v1';
export const PLACEMENT_RESULT_SCHEMA_VERSION = 'placement-result/v1';

/** Validated shape of AssessmentDefinitionVersion.config (TD-96). */
export interface PlacementConfig {
  schemaVersion: typeof PLACEMENT_CONFIG_SCHEMA_VERSION;
  engine: typeof PLACEMENT_ENGINE_VERSION;
  selection: {
    startDifficulty: number; // initial per-skill target difficulty band
    stepUp: number; // per-skill target increase after a correct answer
    stepDown: number; // per-skill target decrease after an incorrect answer
  };
  coverage: {
    itemsPerSkill: number; // evidence quota per skill represented in the pinned pool
  };
  stopping: {
    maxItems: number; // hard safety cap — prevents an infinite assessment (§19)
  };
  // Version-pinned ordinal normalization scale for Skill Profile derivation (Phase 1.5C, TD-97).
  // NOT CEFR — a stable [min,max] so the same difficulty rank maps to the same mastery regardless of
  // which items a later version pools. All effective item difficulties must lie within [min,max].
  profileScale: {
    minDifficulty: number;
    maxDifficulty: number; // > minDifficulty
  };
}

/** Per-skill adaptive state — one Skill's answers never move another Skill's target (§10/18). */
export interface SkillState {
  targetDifficulty: number;
  answeredCount: number;
}

/** AssessmentAttempt.engineState (class E — resumable mechanics; truth stays in responses). */
export interface PlacementEngineState {
  schemaVersion: typeof PLACEMENT_ENGINE_STATE_SCHEMA_VERSION;
  engineVersion: typeof PLACEMENT_ENGINE_VERSION;
  presentedItemIds: string[]; // no-repeat guard (§20); truth backstop = AssessmentResponse rows
  answeredCount: number; // global
  skills: Record<string, SkillState>; // keyed by skillId (derived from the pinned pool at start)
}

/** One eligible item from the PINNED version pool (AssessmentVersionItem membership). */
export interface PoolItem {
  itemId: string;
  skillId: string;
  difficulty: number; // effective = difficultyOverride ?? item.difficulty
}

/** AssessmentAttempt.resultSummary (class B — lightweight display cache, write-once). */
export interface PlacementResultSummary {
  schemaVersion: typeof PLACEMENT_RESULT_SCHEMA_VERSION;
  engineVersion: typeof PLACEMENT_ENGINE_VERSION;
  answeredCount: number;
  objectiveCorrect: number;
  objectiveScored: number;
  coverageSkillIds: string[]; // distinct skills with at least one submitted response — NO level/CEFR label (§13/20)
  coverageComplete: boolean; // every pool skill met its itemsPerSkill quota
  insufficientSkillIds: string[]; // pool skills that could not meet quota (too few items, §20/33)
}
