import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAccessToken, getAccessToken, setAccessToken } from './token-store';
import { verifyOtp } from '../api/auth';
import { refreshAccessToken, __resetRefreshLatchForTests } from '../api/client';
import { installFetchMock } from '../../test/fetch-mock';

describe('WEB-01 access token is memory-only (never persisted)', () => {
  beforeEach(() => {
    clearAccessToken();
    __resetRefreshLatchForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('holds the token in memory and writes NOTHING to localStorage/sessionStorage during auth', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    installFetchMock((call) => {
      if (call.url.endsWith('/api/auth/otp/verify')) return { status: 200, body: { accessToken: 'TOK1', tokenType: 'Bearer', expiresIn: 900, user: { id: 'u1', onboardingCompleted: true } } };
      if (call.url.endsWith('/api/auth/refresh')) return { status: 200, body: { accessToken: 'TOK2', tokenType: 'Bearer', expiresIn: 900 } };
      return { status: 200, body: {} };
    });

    const user = await verifyOtp('11111111-1111-1111-1111-111111111111', '123456');
    expect(user.id).toBe('u1');
    expect(getAccessToken()).toBe('TOK1');

    const t = await refreshAccessToken();
    expect(t).toBe('TOK2');
    expect(getAccessToken()).toBe('TOK2');

    // No auth token ever touched web storage.
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });
});
