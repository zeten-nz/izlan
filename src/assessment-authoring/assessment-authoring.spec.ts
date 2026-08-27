import { applyEditableConfig, DEFAULT_PLACEMENT_CONFIG, parseAuthoringConfig } from './assessment-config';
import { toLearnerPreviewItem, toStaffConfig, toStaffItem } from './assessment-authoring.presenter';
import { AssessmentInvalidConfigError } from '../common/errors';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../assessment/scoring/item-payload';

const itemPayload = { schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } };

describe('assessment authoring — config helpers (AAC)', () => {
  it('AAC-01 default config is valid and round-trips', () => {
    expect(parseAuthoringConfig(DEFAULT_PLACEMENT_CONFIG)).toEqual(DEFAULT_PLACEMENT_CONFIG);
  });

  it('AAC-02 applyEditableConfig overrides only the editable fields, preserving every system field', () => {
    const next = applyEditableConfig(DEFAULT_PLACEMENT_CONFIG, { itemsPerSkill: 1, maxItems: 25, startDifficulty: 4 });
    expect(next.coverage.itemsPerSkill).toBe(1);
    expect(next.stopping.maxItems).toBe(25);
    expect(next.selection.startDifficulty).toBe(4);
    // system fields untouched
    expect(next.selection.stepUp).toBe(DEFAULT_PLACEMENT_CONFIG.selection.stepUp);
    expect(next.selection.stepDown).toBe(DEFAULT_PLACEMENT_CONFIG.selection.stepDown);
    expect(next.profileScale).toEqual(DEFAULT_PLACEMENT_CONFIG.profileScale);
    expect(next.schemaVersion).toBe(DEFAULT_PLACEMENT_CONFIG.schemaVersion);
    expect(next.engine).toBe(DEFAULT_PLACEMENT_CONFIG.engine);
  });

  it('AAC-03 startDifficulty outside profileScale → AssessmentInvalidConfigError', () => {
    expect(() => applyEditableConfig(DEFAULT_PLACEMENT_CONFIG, { startDifficulty: 99 })).toThrow(AssessmentInvalidConfigError);
  });

  it('AAC-04 malformed config → AssessmentInvalidConfigError (never a blind cast)', () => {
    expect(() => parseAuthoringConfig({ nonsense: true })).toThrow(AssessmentInvalidConfigError);
  });

  it('AAC-05 toStaffConfig surfaces editable + system fields', () => {
    expect(toStaffConfig(DEFAULT_PLACEMENT_CONFIG)).toEqual({
      itemsPerSkill: 2, maxItems: 10, startDifficulty: 3,
      system: { stepUp: 1, stepDown: 1, minDifficulty: 1, maxDifficulty: 6 },
    });
  });
});

describe('assessment authoring — answerKey boundary (AAP)', () => {
  it('AAP-01 staff item view INCLUDES answerKey', () => {
    const staff = toStaffItem({ id: 'i1', payload: itemPayload, skillId: 's1', difficulty: 3, difficultyOverride: null, updatedAt: new Date(), ordering: 0 });
    expect(staff.answerKey.correctOptionIds).toEqual(['a']);
    expect(staff.skillId).toBe('s1');
  });

  it('AAP-02 learner preview projection NEVER carries answerKey/correctOptionIds/skillId/difficulty', () => {
    const learner = toLearnerPreviewItem({ id: 'i1', type: 'MINI_QUESTION', payload: itemPayload });
    const json = JSON.stringify(learner);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
    expect(learner).not.toHaveProperty('skillId');
    expect(learner).not.toHaveProperty('difficulty');
    expect(learner.options).toEqual([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
  });
});
