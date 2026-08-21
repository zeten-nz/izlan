import { isValidIanaTimezone } from './timezone.util';

describe('isValidIanaTimezone', () => {
  it.each(['Asia/Tashkent', 'Europe/Berlin', 'America/New_York', 'UTC'])('accepts %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(true);
  });

  it.each(['GMT+5', '', 'Not/AZone', 'asia/tashkent-typo', '   '])('rejects %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(false);
  });

  it('rejects non-string', () => {
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(123)).toBe(false);
  });
});
