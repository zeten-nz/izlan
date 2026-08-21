import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-context';
import { clearAccessToken } from './token-store';
import { __resetRefreshLatchForTests } from '../api/client';
import { installFetchMock, type MockCall } from '../../test/fetch-mock';

const isRefresh = (c: MockCall) => c.url.endsWith('/api/auth/refresh');
const isMe = (c: MockCall) => c.url.endsWith('/api/auth/me');

function StatusProbe() {
  const { status, user } = useAuth();
  return <div data-testid="status">{status}{user ? `:${user.id}` : ''}</div>;
}

describe('WEB-02 page bootstrap performs one refresh then /me', () => {
  beforeEach(() => {
    clearAccessToken();
    __resetRefreshLatchForTests();
  });

  it('refreshes once, calls /me once, and becomes authenticated', async () => {
    const mock = installFetchMock((c) => {
      if (isRefresh(c)) return { status: 200, body: { accessToken: 'acc', tokenType: 'Bearer', expiresIn: 900 } };
      if (isMe(c)) return { status: 200, body: { id: 'user-1', onboardingCompleted: true } };
      return { status: 404, body: {} };
    });

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated:user-1'));
    expect(mock.countMatching(isRefresh)).toBe(1);
    expect(mock.countMatching(isMe)).toBe(1);
  });

  it('failed refresh → unauthenticated (not treated as an error loop)', async () => {
    installFetchMock((c) => {
      if (isRefresh(c)) return { status: 401, body: { code: 'AUTH_UNAUTHORIZED' } };
      return { status: 404, body: {} };
    });
    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
  });
});
