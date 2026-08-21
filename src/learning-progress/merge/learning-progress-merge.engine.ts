import { SkillMeasurementSource } from '@prisma/client';
import { MergeConfig, MergeResult, NormalizedMeasurement, mergeWithConfig } from './merge-core';

export type { NormalizedMeasurement, MergeResult } from './merge-core';

/**
 * IMMUTABLE mathematical contract identifier (TD-114). Anchors DIAGNOSTIC/CHECKPOINT; incremental LESSON_MASTERY.
 * The v1 source policy is frozen — REVIEW_MASTERY is NOT added here (learning-progress-merge-v2 owns that, §19).
 */
export const LEARNING_PROGRESS_MERGE_VERSION = 'learning-progress-merge-v1';

const ANCHOR_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([SkillMeasurementSource.DIAGNOSTIC, SkillMeasurementSource.CHECKPOINT]);
const INCREMENTAL_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([SkillMeasurementSource.LESSON_MASTERY]);

/** Explicit v1 source whitelist (§9/10). AI_EVALUATION/ENGINE_RECALC/REVIEW_MASTERY never affect v1 state. */
export const MERGE_SUPPORTED_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([...ANCHOR_SOURCES, ...INCREMENTAL_SOURCES]);

const V1_CONFIG: MergeConfig = { supportedSources: MERGE_SUPPORTED_SOURCES, anchorSources: ANCHOR_SOURCES, incrementalSources: INCREMENTAL_SOURCES };

/** learning-progress-merge-v1 (TD-114). Pure/deterministic; delegates to the shared frozen-config core. */
export function mergeSkill(measurements: NormalizedMeasurement[]): MergeResult | null {
  return mergeWithConfig(measurements, V1_CONFIG);
}
