import { REVIEW_DUE_EVIDENCE_SCHEMA, parseReviewBasis, reviewActivation, reviewIntervalDays, reviewResolves } from './review-due-signal.policy';

const T0 = new Date('2026-08-20T00:00:00.000Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;
const state = (masteryScoreBp: number, confidenceBp: number, evidenceCount: number, lastMeasurementAt: Date | null) => ({ masteryScoreBp, confidenceBp, evidenceCount, lastMeasurementAt });

describe('reviewIntervalDays (review-due-signal-v1, §15)', () => {
  it('§45 confidence < 5000 → 1 day regardless of mastery', () => expect(reviewIntervalDays(9000, 4999)).toBe(1));
  it('§46 low mastery → 1 day', () => expect(reviewIntervalDays(4999, 10000)).toBe(1));
  it('§47 medium band → 3 days (5000 and 6999)', () => {
    expect(reviewIntervalDays(5000, 10000)).toBe(3);
    expect(reviewIntervalDays(6999, 10000)).toBe(3);
  });
  it('§48 good band → 7 days (7000 and 8499)', () => {
    expect(reviewIntervalDays(7000, 10000)).toBe(7);
    expect(reviewIntervalDays(8499, 10000)).toBe(7);
  });
  it('§49 strong band → 14 days (8500 and 10000)', () => {
    expect(reviewIntervalDays(8500, 10000)).toBe(14);
    expect(reviewIntervalDays(10000, 10000)).toBe(14);
  });
});

describe('reviewActivation (§18/50/51)', () => {
  it('§45 1-day interval: not due at +23h59m, due at +24h', () => {
    expect(reviewActivation(state(9000, 4999, 5, T0), plus(DAY - 60_000))).toBeNull();
    const a = reviewActivation(state(9000, 4999, 5, T0), plus(DAY));
    expect(a).toMatchObject({ intervalDays: 1 });
    expect(a!.dueAt.getTime()).toBe(plus(DAY).getTime());
    expect(a!.basisLastMeasurementAt.getTime()).toBe(T0.getTime());
  });

  it('§50 exact dueAt activates (now == dueAt, inclusive)', () => {
    // mastery 7500 → 7-day interval
    expect(reviewActivation(state(7500, 10000, 5, T0), plus(7 * DAY))).toMatchObject({ intervalDays: 7 });
  });

  it('§51 no state / null lastMeasurementAt / zero evidence → no activation', () => {
    expect(reviewActivation(null, plus(100 * DAY))).toBeNull();
    expect(reviewActivation(state(4000, 10000, 5, null), plus(100 * DAY))).toBeNull();
    expect(reviewActivation(state(4000, 10000, 0, T0), plus(100 * DAY))).toBeNull();
  });
});

describe('reviewResolves (§20/52/53)', () => {
  it('§52 strictly-later current evidence resolves', () => expect(reviewResolves(plus(DAY), T0)).toBe(true));
  it('§53 same logical timestamp does NOT resolve', () => expect(reviewResolves(T0, T0)).toBe(false));
  it('null / earlier current → no resolve', () => {
    expect(reviewResolves(null, T0)).toBe(false);
    expect(reviewResolves(plus(-DAY), T0)).toBe(false);
  });
});

describe('parseReviewBasis (§69 strict)', () => {
  it('valid snapshot → Date', () => {
    expect(parseReviewBasis({ schemaVersion: REVIEW_DUE_EVIDENCE_SCHEMA, basisLastMeasurementAt: T0.toISOString() })!.getTime()).toBe(T0.getTime());
  });
  it('wrong schema / missing / non-string → null', () => {
    expect(parseReviewBasis({ schemaVersion: 'other', basisLastMeasurementAt: T0.toISOString() })).toBeNull();
    expect(parseReviewBasis({ schemaVersion: REVIEW_DUE_EVIDENCE_SCHEMA })).toBeNull();
    expect(parseReviewBasis(null)).toBeNull();
    expect(parseReviewBasis({ schemaVersion: REVIEW_DUE_EVIDENCE_SCHEMA, basisLastMeasurementAt: 12345 })).toBeNull();
  });
});
