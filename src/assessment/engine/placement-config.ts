import { AssessmentConfigurationInvalidError } from '../../common/errors';
import {
  PLACEMENT_CONFIG_SCHEMA_VERSION,
  PLACEMENT_ENGINE_VERSION,
  PlacementConfig,
} from './placement-engine.types';

/**
 * Runtime validator for AssessmentDefinitionVersion.config (§8/59/60).
 * JSONB is NEVER cast blindly (`as PlacementConfig`) — a malformed published config must FAIL SAFE
 * (ASSESSMENT_CONFIGURATION_INVALID), never create an infinite/undefined attempt. This validates the
 * config SHAPE only; the pool-relative feasibility check (distinctSkills × itemsPerSkill ≤ maxItems)
 * happens at start time when the pinned pool is known (§19). Logs/throws carry no config internals.
 */

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function fail(): never {
  throw new AssessmentConfigurationInvalidError('assessment engine configuration invalid');
}

export function parsePlacementConfig(raw: unknown): PlacementConfig {
  if (raw === null || typeof raw !== 'object') fail();
  const c = raw as Record<string, unknown>;

  if (c.schemaVersion !== PLACEMENT_CONFIG_SCHEMA_VERSION) fail();
  if (c.engine !== PLACEMENT_ENGINE_VERSION) fail();

  const sel = c.selection;
  if (sel === null || typeof sel !== 'object') fail();
  const s = sel as Record<string, unknown>;
  if (!isInt(s.startDifficulty) || s.startDifficulty < 1) fail();
  if (!isInt(s.stepUp) || s.stepUp < 0) fail();
  if (!isInt(s.stepDown) || s.stepDown < 0) fail();

  const cov = c.coverage;
  if (cov === null || typeof cov !== 'object') fail();
  const cv = cov as Record<string, unknown>;
  if (!isInt(cv.itemsPerSkill) || cv.itemsPerSkill < 1) fail();

  const stop = c.stopping;
  if (stop === null || typeof stop !== 'object') fail();
  const st = stop as Record<string, unknown>;
  if (!isInt(st.maxItems) || st.maxItems < 1) fail();

  const ps = c.profileScale;
  if (ps === null || typeof ps !== 'object') fail();
  const p2 = ps as Record<string, unknown>;
  if (!isInt(p2.minDifficulty) || p2.minDifficulty < 1) fail();
  if (!isInt(p2.maxDifficulty) || p2.maxDifficulty < 1) fail();
  if (p2.maxDifficulty <= p2.minDifficulty) fail();
  // startDifficulty must sit within the normalization scale (§8).
  if (s.startDifficulty < p2.minDifficulty || s.startDifficulty > p2.maxDifficulty) fail();

  return {
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION,
    engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: s.startDifficulty, stepUp: s.stepUp, stepDown: s.stepDown },
    coverage: { itemsPerSkill: cv.itemsPerSkill },
    stopping: { maxItems: st.maxItems },
    profileScale: { minDifficulty: p2.minDifficulty, maxDifficulty: p2.maxDifficulty },
  };
}
