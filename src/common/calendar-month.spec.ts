import { addCalendarMonths } from './calendar-month';

const iso = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));

describe('addCalendarMonths (Phase 2.1G-D §48)', () => {
  it('end-of-month clamping: Jan 31 +1 → Feb 28 (non-leap)', () => {
    expect(addCalendarMonths(iso(2026, 1, 31), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('leap year: Jan 31 +1 → Feb 29 (2028)', () => {
    expect(addCalendarMonths(iso(2028, 1, 31), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('30-day clamp: Mar 31 +1 → Apr 30', () => {
    expect(addCalendarMonths(iso(2026, 3, 31), 1).toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });
  it('mid-month preserved: Jan 15 +1 → Feb 15', () => {
    expect(addCalendarMonths(iso(2026, 1, 15), 1).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });
  it('+12 preserves the calendar date (year rollover)', () => {
    expect(addCalendarMonths(iso(2026, 8, 21), 12).toISOString()).toBe('2027-08-21T00:00:00.000Z');
  });
  it('multi-month rollover across December: Nov 30 +3 → Feb 28', () => {
    expect(addCalendarMonths(iso(2025, 11, 30), 3).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('preserves the time-of-day portion', () => {
    expect(addCalendarMonths(iso(2026, 1, 31, 13, 45, 30, 123), 1).toISOString()).toBe('2026-02-28T13:45:30.123Z');
  });
  it('+0 is identity', () => {
    expect(addCalendarMonths(iso(2026, 8, 21, 9, 0, 0, 0), 0).toISOString()).toBe('2026-08-21T09:00:00.000Z');
  });
  it('rejects negative / non-integer months', () => {
    expect(() => addCalendarMonths(iso(2026, 1, 1), -1)).toThrow(RangeError);
    expect(() => addCalendarMonths(iso(2026, 1, 1), 1.5)).toThrow(RangeError);
  });
});
