import { AssessmentConfigurationInvalidError } from '../../common/errors';
import { parsePlacementConfig } from './placement-config';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from './placement-engine.types';

const valid = {
  schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION,
  engine: PLACEMENT_ENGINE_VERSION,
  selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 },
  coverage: { itemsPerSkill: 2 },
  stopping: { maxItems: 10 },
  profileScale: { minDifficulty: 1, maxDifficulty: 6 },
};

describe('parsePlacementConfig', () => {
  it('accepts a well-formed config', () => {
    expect(parsePlacementConfig(valid)).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['non-object', 42],
    ['wrong schemaVersion', { ...valid, schemaVersion: 'other' }],
    ['wrong engine', { ...valid, engine: 'other' }],
    ['missing selection', { ...valid, selection: undefined }],
    ['non-int startDifficulty', { ...valid, selection: { ...valid.selection, startDifficulty: 2.5 } }],
    ['startDifficulty < 1', { ...valid, selection: { ...valid.selection, startDifficulty: 0 } }],
    ['negative stepUp', { ...valid, selection: { ...valid.selection, stepUp: -1 } }],
    ['missing coverage', { ...valid, coverage: undefined }],
    ['itemsPerSkill < 1', { ...valid, coverage: { itemsPerSkill: 0 } }],
    ['non-int itemsPerSkill', { ...valid, coverage: { itemsPerSkill: 1.5 } }],
    ['maxItems < 1', { ...valid, stopping: { maxItems: 0 } }],
    ['legacy minItems present but maxItems missing', { ...valid, stopping: { minItems: 3 } }],
    ['missing profileScale', { ...valid, profileScale: undefined }],
    ['profileScale max <= min', { ...valid, profileScale: { minDifficulty: 5, maxDifficulty: 5 } }],
    ['startDifficulty outside profileScale', { ...valid, selection: { startDifficulty: 9, stepUp: 1, stepDown: 1 }, profileScale: { minDifficulty: 1, maxDifficulty: 6 } }],
  ])('fails safe on %s', (_label, bad) => {
    expect(() => parsePlacementConfig(bad)).toThrow(AssessmentConfigurationInvalidError);
  });

  it('ignores the removed minItems field (v1 has no minItems)', () => {
    const withLegacy = { ...valid, stopping: { maxItems: 10, minItems: 3 } };
    expect(parsePlacementConfig(withLegacy).stopping).toEqual({ maxItems: 10 });
  });
});
