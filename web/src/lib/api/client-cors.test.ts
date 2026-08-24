import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, refreshAccessToken, __resetRefreshLatchForTests, CSRF_HEADER } from './client';
import { setAccessToken, clearAccessToken } from '../auth/token-store';

function spyFetch(body: unknown) {
  const spy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response,
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  clearAccessToken();
  __resetRefreshLatchForTests();
});

describe('CORS-sensitive request wiring (WEB-CORS)', () => {
  it('WEB-CORS-01 refresh sends credentials:include + the CSRF header and no Bearer', async () => {
    const spy = spyFetch({ accessToken: 'new' });
    await refreshAccessToken();
    const init = spy.mock.calls[0]![1]!;
    const url = String(spy.mock.calls[0]![0]);
    const headers = init.headers as Record<string, string>;
    expect(url).toContain('/api/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(headers[CSRF_HEADER]).toBe('1');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('WEB-CORS-02 an authenticated request attaches the in-memory Bearer token', async () => {
    setAccessToken('abc');
    const spy = spyFetch({ ok: true });
    await apiRequest('/api/profile/me');
    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer abc');
  });
});
