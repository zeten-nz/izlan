import { apiRequest } from './client';
import { setAccessToken, clearAccessToken } from '../auth/token-store';
import type { AuthTokenResponse, AuthUser, CmsSession, OtpRequestResponse } from './types';

/**
 * Auth endpoints (TD-252). PRIMARY login = phone + password. OTP is only for account recovery (password reset) and
 * registration — never ordinary login. The access token returned here is held ONLY in memory (token-store).
 */

/** Primary login: phone + password → in-memory access token + HttpOnly refresh cookie. */
export async function login(phone: string, password: string): Promise<AuthUser> {
  const res = await apiRequest<AuthTokenResponse>('/api/auth/login', {
    method: 'POST',
    body: { phone, password },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include',
  });
  setAccessToken(res.accessToken);
  return res.user ?? { id: '', onboardingCompleted: false };
}

/** Request a phone-verification OTP for recovery (PASSWORD_RESET) or registration (default). */
export function requestOtp(phone: string, purpose?: 'PASSWORD_RESET' | 'REGISTRATION'): Promise<OtpRequestResponse> {
  return apiRequest<OtpRequestResponse>('/api/auth/otp/request', {
    method: 'POST',
    body: purpose ? { phone, purpose } : { phone },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include',
  });
}

/** Complete a password reset: verified PASSWORD_RESET OTP + new password. Does NOT create a session. */
export function resetPassword(challengeId: string, code: string, password: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>('/api/auth/password/reset', {
    method: 'POST',
    body: { challengeId, code, password },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include',
  });
}

/** Registration: verified REGISTRATION OTP + chosen password → account + session. */
export async function register(challengeId: string, code: string, password: string): Promise<AuthUser> {
  const res = await apiRequest<AuthTokenResponse>('/api/auth/register', {
    method: 'POST',
    body: { challengeId, code, password },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include',
  });
  setAccessToken(res.accessToken);
  return res.user ?? { id: '', onboardingCompleted: false };
}

export function fetchMe(): Promise<AuthUser> {
  return apiRequest<AuthUser>('/api/auth/me');
}

export function fetchCmsSession(): Promise<CmsSession> {
  return apiRequest<CmsSession>('/api/staff/content/session');
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<void>('/api/auth/logout', { method: 'POST', credentials: 'include', noRefresh: true });
  } finally {
    clearAccessToken();
  }
}
