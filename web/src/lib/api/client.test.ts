import { describe, it, expect, beforeEach } from 'vitest';
import { apiRequest, __resetRefreshLatchForTests } from './client';
import { NetworkError, UnauthenticatedError } from './errors';
import { getAccessToken, setAccessToken, clearAccessToken } from '../auth/token-store';
import { installFetchMock, type MockCall } from '../../test/fetch-mock';

const isRefresh = (c: MockCall) => c.url.endsWith('/api/auth/refresh');
const isX = (c: MockCall) => c.url.endsWith('/api/x');

beforeEach(() => {
  clearAccessToken();
  __resetRefreshLatchForTests();
});

describe('WEB-03/04 single-flight refresh + retry-once', () => {
  it('two simultaneous 401s trigger exactly ONE refresh and each request retries once and resolves', async () => {
    setAccessToken('old');
    const mock = installFetchMock((c) => {
      if (isRefresh(c)) return { status: 200, body: { accessToken: 'new' } };
      if (isX(c)) return c.headers['authorization'] === 'Bearer new' ? { status: 200, body: { ok: true } } : { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      return { status: 404, body: {} };
    });

    const [r1, r2] = await Promise.all([apiRequest<{ ok: boolean }>('/api/x'), apiRequest<{ ok: boolean }>('/api/x')]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mock.countMatching(isRefresh)).toBe(1); // single-flight: only one rotation
    expect(getAccessToken()).toBe('new');
  });
});

describe('WEB-05 failed refresh does not loop', () => {
  it('a 401 whose refresh also fails rejects with UnauthenticatedError, refreshing once and not retrying the request', async () => {
    setAccessToken('old');
    const mock = installFetchMock((c) => {
      if (isRefresh(c)) return { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      if (isX(c)) return { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      return { status: 404, body: {} };
    });

    await expect(apiRequest('/api/x')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mock.countMatching(isRefresh)).toBe(1); // exactly one refresh attempt
    expect(mock.countMatching(isX)).toBe(1); // original request NOT retried after refresh failed
    expect(getAccessToken()).toBeNull(); // token cleared
  });
});

describe('WEB-REFRESH-NET a refresh TRANSPORT failure is retryable, not a session loss', () => {
  it('a 401 whose refresh transport-fails rejects NetworkError, keeps the token, and refreshes exactly once', async () => {
    setAccessToken('old');
    const mock = installFetchMock((c) => {
      if (isRefresh(c)) throw new TypeError('CORS request did not succeed'); // browser transport failure (status null)
      if (isX(c)) return { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      return { status: 404, body: {} };
    });
    // classified as a retryable NetworkError — NOT UnauthenticatedError, and the session token is NOT wiped
    await expect(apiRequest('/api/x')).rejects.toBeInstanceOf(NetworkError);
    expect(mock.countMatching(isRefresh)).toBe(1);
    expect(getAccessToken()).toBe('old');
  });

  it('after a refresh transport failure the single-flight is cleared, so a later request can refresh again and recover', async () => {
    setAccessToken('old');
    let refreshCalls = 0;
    const mock = installFetchMock((c) => {
      if (isRefresh(c)) {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new TypeError('network'); // first attempt: transport failure
        return { status: 200, body: { accessToken: 'new' } }; // later attempt: backend is back
      }
      if (isX(c)) return c.headers['authorization'] === 'Bearer new' ? { status: 200, body: { ok: true } } : { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      return { status: 404, body: {} };
    });
    await expect(apiRequest('/api/x')).rejects.toBeInstanceOf(NetworkError); // first request: refresh transport-fails
    const r = await apiRequest<{ ok: boolean }>('/api/x'); // second request: refresh succeeds → retry → ok
    expect(r.ok).toBe(true);
    expect(refreshCalls).toBe(2); // latch was cleared after the failure — a fresh refresh was attempted
    expect(mock.countMatching(isRefresh)).toBe(2);
  });
});

describe('client does not auto-retry a 409 conflict', () => {
  it('surfaces CONTENT_EDIT_CONFLICT without retrying', async () => {
    setAccessToken('tok');
    const mock = installFetchMock((c) => {
      if (isX(c)) return { status: 409, body: { code: 'CONTENT_EDIT_CONFLICT', message: 'conflict' } };
      return { status: 404, body: {} };
    });
    await expect(apiRequest('/api/x', { method: 'PATCH', body: {} })).rejects.toMatchObject({ code: 'CONTENT_EDIT_CONFLICT' });
    expect(mock.countMatching(isX)).toBe(1); // no retry
    expect(mock.countMatching(isRefresh)).toBe(0); // 409 never triggers a refresh
  });
});
