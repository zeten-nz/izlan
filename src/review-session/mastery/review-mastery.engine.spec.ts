import { deriveReviewMastery } from './review-mastery.engine';

describe('deriveReviewMastery (review-mastery-v1)', () => {
  it('§11/§63 mean of best-per-activity scores; confidence 10000; evidenceCount = distinct activities', () => {
    expect(deriveReviewMastery([10000, 0, 10000])).toEqual({ scoreBp: 6667, confidenceBp: 10000, evidenceCount: 3 }); // round(20000/3)
  });

  it('§65 all-wrong review → score 0 (no threshold), still measured', () => {
    expect(deriveReviewMastery([0, 0, 0])).toEqual({ scoreBp: 0, confidenceBp: 10000, evidenceCount: 3 });
  });

  it('single selected activity', () => {
    expect(deriveReviewMastery([10000])).toEqual({ scoreBp: 10000, confidenceBp: 10000, evidenceCount: 1 });
  });

  it('round-half-up at the exact midpoint', () => {
    expect(deriveReviewMastery([5000, 5001]).scoreBp).toBe(5001); // round(10001/2)=5000.5 → 5001
  });

  it('empty selection throws (guarded by the caller)', () => {
    expect(() => deriveReviewMastery([])).toThrow();
  });
});
