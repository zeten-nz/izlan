import { validateChoiceQuestionBody, ChoiceQuestionFormat } from './choice-question-payload';

// Sentinel domain error — the primitive throws whatever `fail` throws, preserving domain error identity.
class Rejected extends Error {}
const fail = (): never => {
  throw new Rejected('rejected');
};

const run = (format: ChoiceQuestionFormat, prompt: unknown, options: unknown, answerKey: unknown) =>
  validateChoiceQuestionBody(format, prompt, options, answerKey, fail);

const twoOpts = [
  { id: 'a', text: 'A' },
  { id: 'b', text: 'B' },
];

describe('validateChoiceQuestionBody (shared choice-question primitive, TD-246 §12)', () => {
  it('CQ-01 accepts a valid single_choice body and normalizes correctOptionIds', () => {
    const v = run('single_choice', 'Q', twoOpts, { correctOptionIds: ['a'] });
    expect(v).toEqual({ format: 'single_choice', prompt: 'Q', options: twoOpts, correctOptionIds: ['a'] });
  });

  it('CQ-02 accepts multiple_choice with >=1 correct', () => {
    const opts = [...twoOpts, { id: 'c', text: 'C' }];
    expect(run('multiple_choice', 'Q', opts, { correctOptionIds: ['a', 'b'] }).correctOptionIds).toEqual(['a', 'b']);
  });

  it('CQ-03 accepts true_false with exactly two options and one correct', () => {
    expect(run('true_false', 'Q', twoOpts, { correctOptionIds: ['a'] }).format).toBe('true_false');
  });

  it('CQ-04 invokes fail (throws the domain error) on: empty prompt', () => {
    expect(() => run('single_choice', '   ', twoOpts, { correctOptionIds: ['a'] })).toThrow(Rejected);
  });

  it('CQ-05 <2 options rejected', () => {
    expect(() => run('single_choice', 'Q', [{ id: 'a', text: 'A' }], { correctOptionIds: ['a'] })).toThrow(Rejected);
  });

  it('CQ-06 duplicate option id rejected', () => {
    expect(() =>
      run('single_choice', 'Q', [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }], { correctOptionIds: ['a'] }),
    ).toThrow(Rejected);
  });

  it('CQ-07 non-string / empty option id rejected', () => {
    expect(() => run('single_choice', 'Q', [{ id: '', text: 'A' }, { id: 'b', text: 'B' }], { correctOptionIds: ['b'] })).toThrow(Rejected);
  });

  it('CQ-08 unknown correct id rejected', () => {
    expect(() => run('single_choice', 'Q', twoOpts, { correctOptionIds: ['z'] })).toThrow(Rejected);
  });

  it('CQ-09 empty correct set rejected', () => {
    expect(() => run('single_choice', 'Q', twoOpts, { correctOptionIds: [] })).toThrow(Rejected);
  });

  it('CQ-10 single_choice with multiple correct rejected', () => {
    expect(() => run('single_choice', 'Q', twoOpts, { correctOptionIds: ['a', 'b'] })).toThrow(Rejected);
  });

  it('CQ-11 true_false with !=2 options rejected', () => {
    const three = [...twoOpts, { id: 'c', text: 'C' }];
    expect(() => run('true_false', 'Q', three, { correctOptionIds: ['a'] })).toThrow(Rejected);
  });

  it('CQ-12 missing / malformed answerKey rejected', () => {
    expect(() => run('single_choice', 'Q', twoOpts, undefined)).toThrow(Rejected);
    expect(() => run('single_choice', 'Q', twoOpts, { correctOptionIds: 'a' })).toThrow(Rejected);
  });
});
