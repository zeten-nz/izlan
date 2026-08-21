import { AssessmentConfigurationInvalidError, AssessmentInvalidResponseError } from '../../common/errors';
import { ObjectiveScorerService } from './objective-scorer.service';
import { PLACEMENT_ITEM_SCHEMA_VERSION, parseItemPayload, projectItemForLearner } from './item-payload';

const single = {
  schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION,
  format: 'single_choice',
  prompt: 'Pick A',
  options: [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
  ],
  answerKey: { correctOptionIds: ['a'] },
};
const multi = {
  schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION,
  format: 'multiple_choice',
  prompt: 'Pick A and B',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  answerKey: { correctOptionIds: ['a', 'b'] },
};
const trueFalse = {
  schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION,
  format: 'true_false',
  prompt: 'Sky is blue',
  options: [
    { id: 't', text: 'True' },
    { id: 'f', text: 'False' },
  ],
  answerKey: { correctOptionIds: ['t'] },
};

describe('ObjectiveScorerService', () => {
  const scorer = new ObjectiveScorerService();

  describe('single_choice', () => {
    const p = parseItemPayload(single);
    it('correct → 10000', () => expect(scorer.score(p, { selectedOptionId: 'a' })).toEqual({ isCorrect: true, deterministicScore: 10000 }));
    it('incorrect → 0', () => expect(scorer.score(p, { selectedOptionId: 'b' })).toEqual({ isCorrect: false, deterministicScore: 0 }));
    it('unknown option rejected', () => expect(() => scorer.score(p, { selectedOptionId: 'z' })).toThrow(AssessmentInvalidResponseError));
    it('malformed (missing key) rejected', () => expect(() => scorer.score(p, {})).toThrow(AssessmentInvalidResponseError));
    it('extra/injected field rejected', () => expect(() => scorer.score(p, { selectedOptionId: 'a', isCorrect: true })).toThrow(AssessmentInvalidResponseError));
    it('wrong answer shape rejected', () => expect(() => scorer.score(p, { selectedOptionIds: ['a'] })).toThrow(AssessmentInvalidResponseError));
    it('deterministic (stable across calls)', () => {
      for (let i = 0; i < 20; i++) expect(scorer.score(p, { selectedOptionId: 'a' }).deterministicScore).toBe(10000);
    });
  });

  describe('multiple_choice', () => {
    const p = parseItemPayload(multi);
    it('exact set correct (order-independent)', () => {
      expect(scorer.score(p, { selectedOptionIds: ['a', 'b'] }).isCorrect).toBe(true);
      expect(scorer.score(p, { selectedOptionIds: ['b', 'a'] }).isCorrect).toBe(true);
    });
    it('superset / subset incorrect', () => {
      expect(scorer.score(p, { selectedOptionIds: ['a', 'b', 'c'] }).isCorrect).toBe(false);
      expect(scorer.score(p, { selectedOptionIds: ['a'] }).isCorrect).toBe(false);
    });
    it('duplicate choices REJECTED ([a,a,b]) — not silently canonicalized (§3)', () => expect(() => scorer.score(p, { selectedOptionIds: ['a', 'a', 'b'] })).toThrow(AssessmentInvalidResponseError));
    it('duplicate [a,a] rejected', () => expect(() => scorer.score(p, { selectedOptionIds: ['a', 'a'] })).toThrow(AssessmentInvalidResponseError));
    it('unknown option rejected', () => expect(() => scorer.score(p, { selectedOptionIds: ['a', 'z'] })).toThrow(AssessmentInvalidResponseError));
    it('empty selection rejected', () => expect(() => scorer.score(p, { selectedOptionIds: [] })).toThrow(AssessmentInvalidResponseError));
  });

  describe('canonicalize (replay comparison, §5)', () => {
    const sc = parseItemPayload(single);
    const mc = parseItemPayload(multi);
    it('single_choice: same id → equal, different id → not equal', () => {
      expect(scorer.canonicalize(sc, { selectedOptionId: 'a' })).toBe(scorer.canonicalize(sc, { selectedOptionId: 'a' }));
      expect(scorer.canonicalize(sc, { selectedOptionId: 'a' })).not.toBe(scorer.canonicalize(sc, { selectedOptionId: 'b' }));
    });
    it('multiple_choice: order-independent equality, different set not equal', () => {
      expect(scorer.canonicalize(mc, { selectedOptionIds: ['a', 'b'] })).toBe(scorer.canonicalize(mc, { selectedOptionIds: ['b', 'a'] }));
      expect(scorer.canonicalize(mc, { selectedOptionIds: ['a', 'b'] })).not.toBe(scorer.canonicalize(mc, { selectedOptionIds: ['a', 'c'] }));
    });
    it('rejects malformed / duplicate while canonicalizing', () => {
      expect(() => scorer.canonicalize(mc, { selectedOptionIds: ['a', 'a'] })).toThrow(AssessmentInvalidResponseError);
      expect(() => scorer.canonicalize(sc, {})).toThrow(AssessmentInvalidResponseError);
    });
  });

  describe('true_false', () => {
    const p = parseItemPayload(trueFalse);
    it('correct / incorrect', () => {
      expect(scorer.score(p, { selectedOptionId: 't' }).isCorrect).toBe(true);
      expect(scorer.score(p, { selectedOptionId: 'f' }).isCorrect).toBe(false);
    });
  });

  it('refuses to score an open-ended item', () => {
    const open = parseItemPayload({ schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'open_ended', prompt: 'Write an essay' });
    expect(() => scorer.score(open, { text: 'hi' })).toThrow(AssessmentInvalidResponseError);
  });
});

describe('parseItemPayload (PLACEMENT_ITEM_V1)', () => {
  it('accepts each supported format', () => {
    expect(parseItemPayload(single).format).toBe('single_choice');
    expect(parseItemPayload(multi).format).toBe('multiple_choice');
    expect(parseItemPayload(trueFalse).format).toBe('true_false');
    expect(parseItemPayload({ schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'open_ended', prompt: 'Q' }).format).toBe('open_ended');
  });

  it.each([
    ['wrong schemaVersion', { ...single, schemaVersion: 'x' }],
    ['empty prompt', { ...single, prompt: '  ' }],
    ['unknown format', { ...single, format: 'matching' }],
    ['too few options', { ...single, options: [{ id: 'a', text: 'A' }] }],
    ['true_false !=2 options', { ...trueFalse, options: [...trueFalse.options, { id: 'x', text: 'X' }] }],
    ['duplicate option id', { ...single, options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] }],
    ['answerKey unknown id', { ...single, answerKey: { correctOptionIds: ['z'] } }],
    ['single with 2 correct', { ...single, answerKey: { correctOptionIds: ['a', 'b'] } }],
    ['open_ended with options', { schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'open_ended', prompt: 'Q', options: [] }],
  ])('rejects %s', (_label, bad) => {
    expect(() => parseItemPayload(bad)).toThrow(AssessmentConfigurationInvalidError);
  });

  it('learner projection strips the answer key and correctness flags (§16/52)', () => {
    const view = projectItemForLearner('item-1', 'MINI_QUESTION', parseItemPayload(single));
    const json = JSON.stringify(view);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
    expect(view.options).toEqual([{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }]);
    expect(view).not.toHaveProperty('difficulty');
    expect(view).not.toHaveProperty('skillId');
  });
});
