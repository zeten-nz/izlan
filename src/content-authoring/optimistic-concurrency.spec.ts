import { nextOptimisticTimestamp } from './optimistic-concurrency';

describe('nextOptimisticTimestamp (strict-monotonic OCC token, TIMESTAMP(3))', () => {
  afterEach(() => jest.restoreAllMocks());

  it('OCC-02 now == expected → expected + 1ms', () => {
    const expected = new Date('2026-08-21T10:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(expected.getTime());
    expect(nextOptimisticTimestamp(expected).getTime()).toBe(expected.getTime() + 1);
  });

  it('OCC-03 now < expected (clock moved backwards) → expected + 1ms', () => {
    const expected = new Date('2026-08-21T10:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(expected.getTime() - 5000);
    expect(nextOptimisticTimestamp(expected).getTime()).toBe(expected.getTime() + 1);
  });

  it('OCC-04 now > expected → now is used, and still strictly greater than expected', () => {
    const expected = new Date('2026-08-21T10:00:00.000Z');
    const now = expected.getTime() + 250;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const out = nextOptimisticTimestamp(expected).getTime();
    expect(out).toBe(now);
    expect(out).toBeGreaterThan(expected.getTime());
  });

  it('always strictly advances (property over a range of clock offsets)', () => {
    const expected = new Date('2026-08-21T10:00:00.000Z');
    for (const offset of [-10000, -1, 0, 1, 999, 100000]) {
      jest.spyOn(Date, 'now').mockReturnValue(expected.getTime() + offset);
      expect(nextOptimisticTimestamp(expected).getTime()).toBeGreaterThan(expected.getTime());
      jest.restoreAllMocks();
    }
  });
});
