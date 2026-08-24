import { describe, it, expect } from 'vitest';
import { describeError } from './error-text';
import { defaultT } from '../i18n/i18n-context';
import { ApiError, NetworkError, UnauthenticatedError } from '../api/errors';

const NETWORK = defaultT('errors.network');
const GENERIC = defaultT('errors.generic');

describe('describeError taxonomy (WEB-ERR)', () => {
  it('WEB-ERR-01 NetworkError → the network message', () => {
    expect(describeError(new NetworkError())).toBe(NETWORK);
  });

  it('WEB-ERR-02 ApiError with a known code → its localized message (NOT network)', () => {
    const msg = describeError(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    expect(msg).toBe(defaultT('errors.AUTH_INVALID_CREDENTIALS'));
    expect(msg).not.toBe(NETWORK);
  });

  it('WEB-ERR-03 ApiError with an unknown code → generic (never the raw code, never network)', () => {
    const msg = describeError(new ApiError(500, 'SOME_WEIRD_CODE', 'boom'));
    expect(msg).toBe(GENERIC);
    expect(msg).not.toContain('SOME_WEIRD_CODE');
    expect(msg).not.toBe(NETWORK);
  });

  it('WEB-ERR-04 UnauthenticatedError → session/auth message', () => {
    expect(describeError(new UnauthenticatedError())).toBe(defaultT('errors.AUTH_UNAUTHORIZED'));
  });

  it('WEB-ERR-05 AbortError → empty (cancelled request is never shown, and never as network)', () => {
    expect(describeError(new DOMException('aborted', 'AbortError'))).toBe('');
    expect(describeError({ name: 'AbortError' })).toBe('');
  });

  it('WEB-ERR-06 an unknown/programming error does NOT become a network message', () => {
    const msg = describeError(new TypeError('cannot read x of undefined'));
    expect(msg).toBe(GENERIC);
    expect(msg).not.toBe(NETWORK);
  });

  it('WEB-ERR-07 a non-Error value → generic (not network)', () => {
    expect(describeError('weird string')).toBe(GENERIC);
    expect(describeError({ foo: 1 })).toBe(GENERIC);
    expect(describeError(undefined)).toBe(GENERIC);
  });
});
