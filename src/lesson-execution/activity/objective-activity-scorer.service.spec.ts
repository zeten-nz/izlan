import { ActivityInvalidResponseError } from '../../common/errors';
import { ObjectiveActivityScorerService } from './objective-activity-scorer.service';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, parseObjectiveActivityPayload } from './objective-activity-payload';

const single = parseObjectiveActivityPayload({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
const trueFalse = parseObjectiveActivityPayload({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'true_false', prompt: 'Q', options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }], answerKey: { correctOptionIds: ['t'] } });
const multi = parseObjectiveActivityPayload({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'multiple_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], answerKey: { correctOptionIds: ['a', 'b'] } });

describe('ObjectiveActivityScorerService (§45)', () => {
  const scorer = new ObjectiveActivityScorerService();

  describe('single_choice', () => {
    it('correct → 10000', () => expect(scorer.score(single, { selectedOptionId: 'a' })).toEqual({ isCorrect: true, deterministicScore: 10000 }));
    it('incorrect → 0', () => expect(scorer.score(single, { selectedOptionId: 'b' })).toEqual({ isCorrect: false, deterministicScore: 0 }));
    it('unknown option rejected', () => expect(() => scorer.score(single, { selectedOptionId: 'z' })).toThrow(ActivityInvalidResponseError));
    it('malformed rejected', () => expect(() => scorer.score(single, {})).toThrow(ActivityInvalidResponseError));
    it('extra/injected field rejected', () => expect(() => scorer.score(single, { selectedOptionId: 'a', isCorrect: true })).toThrow(ActivityInvalidResponseError));
  });

  describe('true_false', () => {
    it('correct / incorrect', () => {
      expect(scorer.score(trueFalse, { selectedOptionId: 't' }).isCorrect).toBe(true);
      expect(scorer.score(trueFalse, { selectedOptionId: 'f' }).isCorrect).toBe(false);
    });
  });

  describe('multiple_choice', () => {
    it('exact set correct, order-independent', () => {
      expect(scorer.score(multi, { selectedOptionIds: ['a', 'b'] }).isCorrect).toBe(true);
      expect(scorer.score(multi, { selectedOptionIds: ['b', 'a'] }).isCorrect).toBe(true);
    });
    it('subset / superset incorrect', () => {
      expect(scorer.score(multi, { selectedOptionIds: ['a'] }).isCorrect).toBe(false);
      expect(scorer.score(multi, { selectedOptionIds: ['a', 'b', 'c'] }).isCorrect).toBe(false);
    });
    it('duplicate learner selection invalid', () => expect(() => scorer.score(multi, { selectedOptionIds: ['a', 'a', 'b'] })).toThrow(ActivityInvalidResponseError));
    it('unknown option invalid; empty invalid', () => {
      expect(() => scorer.score(multi, { selectedOptionIds: ['a', 'z'] })).toThrow(ActivityInvalidResponseError);
      expect(() => scorer.score(multi, { selectedOptionIds: [] })).toThrow(ActivityInvalidResponseError);
    });
  });

  describe('canonicalize (idempotency, §17)', () => {
    it('single: same id equal, different not', () => {
      expect(scorer.canonicalize(single, { selectedOptionId: 'a' })).toBe(scorer.canonicalize(single, { selectedOptionId: 'a' }));
      expect(scorer.canonicalize(single, { selectedOptionId: 'a' })).not.toBe(scorer.canonicalize(single, { selectedOptionId: 'b' }));
    });
    it('multiple: order-independent equal, different set not', () => {
      expect(scorer.canonicalize(multi, { selectedOptionIds: ['a', 'b'] })).toBe(scorer.canonicalize(multi, { selectedOptionIds: ['b', 'a'] }));
      expect(scorer.canonicalize(multi, { selectedOptionIds: ['a', 'b'] })).not.toBe(scorer.canonicalize(multi, { selectedOptionIds: ['a', 'c'] }));
    });
  });
});
