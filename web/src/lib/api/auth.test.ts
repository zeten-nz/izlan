import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./client', () => ({ apiRequest: h.apiRequest, CSRF_HEADER: 'X-Izlan-CSRF' }));
vi.mock('../auth/token-store', () => ({ setAccessToken: vi.fn(), clearAccessToken: vi.fn() }));

import { login, requestOtp, register, resetPassword } from './auth';

/** These CORS-sensitive public auth calls MUST carry credentials (cookie flow) and skip the Bearer/refresh machinery. */
describe('Auth client request options (WEB-AUTHOPT)', () => {
  beforeEach(() => h.apiRequest.mockReset());

  it('WEB-AUTHOPT-01 login → POST /api/auth/login, credentials:include, public (skipAuth), no refresh retry', async () => {
    h.apiRequest.mockResolvedValue({ accessToken: 't', user: { id: 'u', onboardingCompleted: false } });
    await login('+998900000003', 'pw');
    expect(h.apiRequest).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include', skipAuth: true, noRefresh: true, body: { phone: '+998900000003', password: 'pw' } }),
    );
  });

  it('WEB-AUTHOPT-02 requestOtp → POST /api/auth/otp/request, credentials:include, public', async () => {
    h.apiRequest.mockResolvedValue({ challengeId: 'c', expiresIn: 1, resendAfter: 1 });
    await requestOtp('+998900000003', 'REGISTRATION');
    expect(h.apiRequest).toHaveBeenCalledWith(
      '/api/auth/otp/request',
      expect.objectContaining({ method: 'POST', credentials: 'include', skipAuth: true, noRefresh: true }),
    );
  });

  it('WEB-AUTHOPT-03 register → POST /api/auth/register, credentials:include, public', async () => {
    h.apiRequest.mockResolvedValue({ accessToken: 't', user: { id: 'u', onboardingCompleted: false } });
    await register('c1', '123456', 'pw');
    expect(h.apiRequest).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST', credentials: 'include', skipAuth: true, noRefresh: true }),
    );
  });

  it('WEB-AUTHOPT-04 resetPassword → POST /api/auth/password/reset, credentials:include, public', async () => {
    h.apiRequest.mockResolvedValue({ status: 'ok' });
    await resetPassword('c1', '123456', 'pw');
    expect(h.apiRequest).toHaveBeenCalledWith(
      '/api/auth/password/reset',
      expect.objectContaining({ method: 'POST', credentials: 'include', skipAuth: true, noRefresh: true }),
    );
  });
});
