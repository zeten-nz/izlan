import { ReviewExtraCandidate, selectReviewExtra } from './daily-review-extra-selection';

const c = (o: Partial<ReviewExtraCandidate> & { lessonId: string; skillId: string }): ReviewExtraCandidate => ({
  groupIndex: o.groupIndex ?? 0,
  candidateIndex: o.candidateIndex ?? 0,
  signalTypes: o.signalTypes ?? ['WEAK_SKILL'],
  lessonTopicId: o.lessonTopicId ?? 'T',
  exposure: o.exposure ?? 'COMPLETED',
  directTrigger: o.directTrigger ?? false,
  lessonId: o.lessonId,
  skillId: o.skillId,
});
const T = new Set<string>();

describe('selectReviewExtra (daily-review-extra-v1)', () => {
  it('§47 no candidates → null', () => {
    expect(selectReviewExtra('T', T, [])).toBeNull();
  });

  it('§48 same-Topic candidate is selected', () => {
    expect(selectReviewExtra('T', T, [c({ lessonId: 'R', skillId: 'g', lessonTopicId: 'T' })])).toEqual({ lessonId: 'R', skillId: 'g' });
  });

  it('§49 cross-Topic candidate excluded → null', () => {
    expect(selectReviewExtra('T', T, [c({ lessonId: 'R', skillId: 'g', lessonTopicId: 'OTHER' })])).toBeNull();
  });

  it('§50 lesson already in core is not duplicated; next eligible chosen', () => {
    const core = new Set(['A']);
    expect(selectReviewExtra('T', core, [c({ lessonId: 'A', skillId: 'g' }), c({ lessonId: 'B', skillId: 'g', candidateIndex: 1 })])).toEqual({ lessonId: 'B', skillId: 'g' });
  });

  it('§51 many eligible → exactly one', () => {
    const cands = ['A', 'B', 'C', 'D', 'E'].map((l, i) => c({ lessonId: l, skillId: 'g', candidateIndex: i }));
    expect(selectReviewExtra('T', T, cands)).toEqual({ lessonId: 'A', skillId: 'g' });
  });

  it('§52 directTrigger wins over a higher-reason non-trigger', () => {
    const weakTrigger = c({ lessonId: 'B', skillId: 'v', signalTypes: ['WEAK_SKILL'], directTrigger: true, groupIndex: 1 });
    const repeatedNoTrigger = c({ lessonId: 'A', skillId: 'g', signalTypes: ['REPEATED_MISTAKE'], directTrigger: false, groupIndex: 0 });
    expect(selectReviewExtra('T', T, [repeatedNoTrigger, weakTrigger])).toEqual({ lessonId: 'B', skillId: 'v' });
  });

  it('§53 reason priority REPEATED_MISTAKE > REVIEW_DUE > WEAK_SKILL (no triggers)', () => {
    const weak = c({ lessonId: 'A', skillId: 'a', signalTypes: ['WEAK_SKILL'], groupIndex: 0 });
    const due = c({ lessonId: 'B', skillId: 'b', signalTypes: ['REVIEW_DUE'], groupIndex: 1 });
    const repeated = c({ lessonId: 'C', skillId: 'c', signalTypes: ['REPEATED_MISTAKE'], groupIndex: 2 });
    expect(selectReviewExtra('T', T, [weak, due, repeated])).toEqual({ lessonId: 'C', skillId: 'c' });
    // strongest reason within a mixed group wins
    expect(selectReviewExtra('T', T, [weak, c({ lessonId: 'D', skillId: 'd', signalTypes: ['WEAK_SKILL', 'REVIEW_DUE'], groupIndex: 1 })])).toEqual({ lessonId: 'D', skillId: 'd' });
  });

  it('§54 exposure COMPLETED before IN_PROGRESS (same reason)', () => {
    const inProgress = c({ lessonId: 'A', skillId: 'a', signalTypes: ['REVIEW_DUE'], exposure: 'IN_PROGRESS', groupIndex: 0 });
    const completed = c({ lessonId: 'B', skillId: 'b', signalTypes: ['REVIEW_DUE'], exposure: 'COMPLETED', groupIndex: 1 });
    expect(selectReviewExtra('T', T, [inProgress, completed])).toEqual({ lessonId: 'B', skillId: 'b' });
  });

  it('§55 stable tie-break: skill order (groupIndex) → hierarchy (candidateIndex) → lessonId; deterministic', () => {
    const x = c({ lessonId: 'X', skillId: 's2', groupIndex: 1, candidateIndex: 0 });
    const y = c({ lessonId: 'Y', skillId: 's1', groupIndex: 0, candidateIndex: 5 });
    const both = [x, y];
    expect(selectReviewExtra('T', T, both)).toEqual({ lessonId: 'Y', skillId: 's1' }); // lower groupIndex wins
    expect(selectReviewExtra('T', T, [...both].reverse())).toEqual({ lessonId: 'Y', skillId: 's1' }); // order-independent
  });
});
