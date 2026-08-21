import { ActivityType } from '@prisma/client';
import { ActivityPayloadInvalidError } from '../../common/errors';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, isObjectiveActivityType, parseObjectiveActivityPayload, projectActivityForLearner } from './objective-activity-payload';

const single = {
  schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION,
  format: 'single_choice',
  prompt: 'Pick A',
  options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }],
  answerKey: { correctOptionIds: ['a'] },
};
const trueFalse = { ...single, format: 'true_false', options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }], answerKey: { correctOptionIds: ['t'] } };

describe('parseObjectiveActivityPayload (lesson-activity-objective/v1, §46)', () => {
  it('accepts each supported format', () => {
    expect(parseObjectiveActivityPayload(single).format).toBe('single_choice');
    expect(parseObjectiveActivityPayload(trueFalse).format).toBe('true_false');
    expect(parseObjectiveActivityPayload({ ...single, format: 'multiple_choice', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a', 'b'] } }).format).toBe('multiple_choice');
  });

  it.each([
    ['wrong schemaVersion', { ...single, schemaVersion: 'x' }],
    ['unknown format', { ...single, format: 'matching' }],
    ['empty prompt', { ...single, prompt: '  ' }],
    ['too few options', { ...single, options: [{ id: 'a', text: 'A' }] }],
    ['duplicate option id', { ...single, options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] }],
    ['correct answer outside options', { ...single, answerKey: { correctOptionIds: ['z'] } }],
    ['single with 2 correct', { ...single, answerKey: { correctOptionIds: ['a', 'b'] } }],
    ['true_false not exactly 2 options', { ...trueFalse, options: [{ id: 't', text: 'T' }, { id: 'f', text: 'F' }, { id: 'x', text: 'X' }] }],
    ['empty correctOptionIds', { ...single, answerKey: { correctOptionIds: [] } }],
    ['null', null],
  ])('rejects %s', (_label, bad) => {
    expect(() => parseObjectiveActivityPayload(bad)).toThrow(ActivityPayloadInvalidError);
  });

  it('learner projection strips the answer key + correctness', () => {
    const view = projectActivityForLearner('act-1', 'MINI_QUESTION', 1, parseObjectiveActivityPayload(single));
    const json = JSON.stringify(view);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
    expect(view).toEqual({ id: 'act-1', type: 'MINI_QUESTION', position: 1, format: 'single_choice', prompt: 'Pick A', options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }] });
  });

  it('objective activity types', () => {
    expect(isObjectiveActivityType(ActivityType.MINI_QUESTION)).toBe(true);
    expect(isObjectiveActivityType(ActivityType.PRACTICE)).toBe(true);
    expect(isObjectiveActivityType(ActivityType.MASTERY_TEST)).toBe(true);
    expect(isObjectiveActivityType(ActivityType.WRITING)).toBe(false);
    expect(isObjectiveActivityType(ActivityType.TEXT)).toBe(false);
  });
});
