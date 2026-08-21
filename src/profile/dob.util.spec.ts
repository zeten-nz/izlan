import { parseDobOrThrow, formatDob } from './dob.util';
import { ProfileInvalidDobError } from '../common/errors';

describe('parseDobOrThrow', () => {
  it('parses valid date-only, no timezone shift', () => {
    const d = parseDobOrThrow('2007-05-12');
    expect(formatDob(d)).toBe('2007-05-12');
    expect(d.getUTCFullYear()).toBe(2007);
    expect(d.getUTCMonth()).toBe(4);
    expect(d.getUTCDate()).toBe(12);
  });

  it('rejects future date', () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    expect(() => parseDobOrThrow(`${nextYear}-01-01`)).toThrow(ProfileInvalidDobError);
  });

  it('rejects invalid calendar date (Feb 30)', () => {
    expect(() => parseDobOrThrow('2007-02-30')).toThrow(ProfileInvalidDobError);
  });

  it('rejects wrong format', () => {
    expect(() => parseDobOrThrow('12-05-2007')).toThrow(ProfileInvalidDobError);
    expect(() => parseDobOrThrow('2007/05/12')).toThrow(ProfileInvalidDobError);
    expect(() => parseDobOrThrow('not-a-date')).toThrow(ProfileInvalidDobError);
  });

  it('formatDob handles null', () => {
    expect(formatDob(null)).toBeNull();
  });
});
