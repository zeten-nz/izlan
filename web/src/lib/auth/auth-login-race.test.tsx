import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-context';
import { clearAccessToken } from './token-store';
import { __resetRefreshLatchForTests } from '../api/client';

/**
 * Browser regression (BUG A): logging in while the mount-time auth bootstrap is still in flight left the user "stuck"
 * on /login (and a second "Kirish" then entered without credentials). Root cause: the bootstrap's refresh resolved
 * AFTER the login and overwrote the authenticated state. These tests pin that a login/logout is authoritative.
 */
function fakeResp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function Probe() {
  const { status, user, setAuthenticatedUser, logout } = useAuth();
  return (
    <>
      <div data-testid="status">{status}{user ? `:${user.id}` : ''}</div>
      <button onClick={() => setAuthenticatedUser({ id: 'learner-3', onboardingCompleted: false })}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </>
  );
}

describe('WEB-AUTH-RACE login wins a concurrent bootstrap (stuck-login regression)', () => {
  beforeEach(() => { clearAccessToken(); __resetRefreshLatchForTests(); });

  it('a bootstrap refresh that resolves AFTER login never clobbers the authenticated state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) { await gate; return fakeResp(401, { code: 'AUTH_UNAUTHORIZED' }); }
      if (url.endsWith('/api/auth/me')) return fakeResp(200, { id: 'stale-user', onboardingCompleted: true });
      return fakeResp(404, {});
    }) as unknown as typeof fetch;

    render(<AuthProvider><Probe /></AuthProvider>);
    // The bootstrap refresh is in flight (gated). The learner logs in now.
    fireEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(screen.getByTestId('status').textContent).toBe('authenticated:learner-3');

    // The late bootstrap refresh (a 401 from a clean/no-cookie state) now resolves — it MUST NOT overwrite the login.
    await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated:learner-3'));
  });

  it('a bootstrap /me that resolves AFTER logout never re-authenticates', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) return fakeResp(200, { accessToken: 'acc', tokenType: 'Bearer', expiresIn: 900 });
      if (url.endsWith('/api/auth/me')) { await gate; return fakeResp(200, { id: 'stale-user', onboardingCompleted: true }); }
      if (url.endsWith('/api/auth/logout')) return fakeResp(204, {});
      return fakeResp(404, {});
    }) as unknown as typeof fetch;

    render(<AuthProvider><Probe /></AuthProvider>);
    // bootstrap is paused at /me; the user explicitly logs out
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'logout' })); await Promise.resolve(); });
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');

    await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
  });
});
