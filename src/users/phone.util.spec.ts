import { normalizeUzPhone } from './phone.util';
import { PhoneInvalidError } from '../common/errors';

describe('normalizeUzPhone', () => {
  const CANONICAL = '+998901234567';

  it.each([
    ['+998901234567'],
    ['998901234567'],
    ['901234567'],
    ['+998 90 123 45 67'],
    ['90-123-45-67'],
    ['(90) 123 45 67'],
  ])('normalizes %s → +998901234567', (input) => {
    expect(normalizeUzPhone(input)).toBe(CANONICAL);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['8 digits', '90123456'],
    ['10 local digits', '9012345678'],
    ['wrong country +997', '+997901234567'],
    ['letters', '90abc4567'],
    ['malformed plus', '9+98901234567'],
    ['too long', '9989012345678901'],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeUzPhone(input)).toThrow(PhoneInvalidError);
  });

  it('rejects null/undefined', () => {
    expect(() => normalizeUzPhone(null)).toThrow(PhoneInvalidError);
    expect(() => normalizeUzPhone(undefined)).toThrow(PhoneInvalidError);
  });
});
