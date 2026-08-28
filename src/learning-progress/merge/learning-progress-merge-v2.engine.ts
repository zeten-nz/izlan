import { SkillMeasurementSource } from '@prisma/client';
import { MergeConfig, MergeResult, NormalizedMeasurement, mergeWithConfig } from './merge-core';

/**
 * learning-progress-merge-v2 (TD-131) — the CURRENT materialization engine. Retains ALL v1 formulas + anchor
 * semantics; the incremental source policy includes REVIEW_MASTERY and, for the V2 Learning Core, TEACHING_MASTERY
 * (mastery evidence produced inside a V2 TeachingSession). Anchors are unchanged (DIAGNOSTIC/CHECKPOINT);
 * REVIEW_MASTERY and TEACHING_MASTERY are NEVER anchors (§20/25). For histories with no REVIEW_MASTERY/
 * TEACHING_MASTERY, v2 == v1 byte-for-byte (§27/62). ENGINE_RECALC is never supported (no recursive evidence).
 */
export const LEARNING_PROGRESS_MERGE_V2_VERSION = 'learning-progress-merge-v2';

const ANCHOR_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([SkillMeasurementSource.DIAGNOSTIC, SkillMeasurementSource.CHECKPOINT]);
const INCREMENTAL_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([SkillMeasurementSource.LESSON_MASTERY, SkillMeasurementSource.REVIEW_MASTERY, SkillMeasurementSource.TEACHING_MASTERY]);

/** v2 source whitelist (§21). AI_EVALUATION/ENGINE_RECALC still unsupported. */
export const MERGE_V2_SUPPORTED_SOURCES: ReadonlySet<SkillMeasurementSource> = new Set([...ANCHOR_SOURCES, ...INCREMENTAL_SOURCES]);

const V2_CONFIG: MergeConfig = { supportedSources: MERGE_V2_SUPPORTED_SOURCES, anchorSources: ANCHOR_SOURCES, incrementalSources: INCREMENTAL_SOURCES };

/** learning-progress-merge-v2 (TD-131). Pure/deterministic; delegates to the shared core with the v2 config. */
export function mergeSkillV2(measurements: NormalizedMeasurement[]): MergeResult | null {
  return mergeWithConfig(measurements, V2_CONFIG);
}
