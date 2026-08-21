import { formatDateOnly, localDateInTimezone, toDateOnly } from './local-date.util';

describe('localDateInTimezone', () => {
  it('§37 same UTC instant → different local dates per timezone', () => {
    const instant = new Date('2026-08-19T20:00:00.000Z'); // 20:00 UTC
    expect(localDateInTimezone(instant, 'Asia/Tashkent')).toBe('2026-08-20'); // UTC+5 → 01:00 next day
    expect(localDateInTimezone(instant, 'America/New_York')).toBe('2026-08-19'); // UTC-4 → 16:00 same day
  });

  it('§36 local-midnight boundary in Asia/Tashkent (UTC+5)', () => {
    expect(localDateInTimezone(new Date('2026-08-19T18:59:00.000Z'), 'Asia/Tashkent')).toBe('2026-08-19'); // 23:59 local
    expect(localDateInTimezone(new Date('2026-08-19T19:01:00.000Z'), 'Asia/Tashkent')).toBe('2026-08-20'); // 00:01 local next day
  });

  it('is not the server UTC date', () => {
    // 23:30 UTC is already next local day in Tashkent
    expect(localDateInTimezone(new Date('2026-08-19T23:30:00.000Z'), 'Asia/Tashkent')).toBe('2026-08-20');
  });
});

describe('toDateOnly / formatDateOnly round-trip', () => {
  it('parses to UTC midnight and formats back with no shift', () => {
    const d = toDateOnly('2026-08-20');
    expect(d.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(formatDateOnly(d)).toBe('2026-08-20');
  });
});
