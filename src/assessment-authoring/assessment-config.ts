import { parsePlacementConfig } from '../assessment/engine/placement-config';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION, type PlacementConfig } from '../assessment/engine/placement-engine.types';
import { AssessmentInvalidConfigError } from '../common/errors';

/**
 * Placement config authoring helpers. The runtime `parsePlacementConfig` remains the single validation authority;
 * authoring only ever produces a full PlacementConfig and re-validates it, translating any failure into the
 * authoring-facing AssessmentInvalidConfigError. Methodists edit only itemsPerSkill / maxItems / startDifficulty;
 * every system field (schemaVersion, engine, stepUp, stepDown, profileScale) is preserved server-side.
 */

/** Proven placement defaults for a brand-new version (mirrors the seed's v1 diagnostic config). */
export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION,
  engine: PLACEMENT_ENGINE_VERSION,
  selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 },
  coverage: { itemsPerSkill: 2 },
  stopping: { maxItems: 10 },
  profileScale: { minDifficulty: 1, maxDifficulty: 6 },
};

/** Parse+validate a stored/raw config; authoring surfaces AssessmentInvalidConfigError instead of the runtime error. */
export function parseAuthoringConfig(raw: unknown): PlacementConfig {
  try {
    return parsePlacementConfig(raw);
  } catch {
    throw new AssessmentInvalidConfigError('invalid placement config');
  }
}

/** Merge Methodist-editable fields into an existing valid config, preserving ALL system fields, then re-validate. */
export function applyEditableConfig(
  current: PlacementConfig,
  edits: { itemsPerSkill?: number; maxItems?: number; startDifficulty?: number },
): PlacementConfig {
  const merged = {
    schemaVersion: current.schemaVersion,
    engine: current.engine,
    selection: {
      startDifficulty: edits.startDifficulty ?? current.selection.startDifficulty,
      stepUp: current.selection.stepUp,
      stepDown: current.selection.stepDown,
    },
    coverage: { itemsPerSkill: edits.itemsPerSkill ?? current.coverage.itemsPerSkill },
    stopping: { maxItems: edits.maxItems ?? current.stopping.maxItems },
    profileScale: { minDifficulty: current.profileScale.minDifficulty, maxDifficulty: current.profileScale.maxDifficulty },
  };
  return parseAuthoringConfig(merged); // re-validate (e.g. startDifficulty must stay within profileScale)
}
