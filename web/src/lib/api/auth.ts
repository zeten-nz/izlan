import { apiRequest } from './client';
import { setAccessToken, clearAccessToken } from '../auth/token-store';
import type { AuthTokenResponse, AuthUser, CmsSession, OtpRequestResponse } from './types';

/** Auth endpoints. The access token returned here is held ONLY in memory (token-store), never persisted. */

export function requestOtp(phone: string): Promise<OtpRequestResponse> {
  return apiRequest<OtpRequestResponse>('/api/auth/otp/request', {
    method: 'POST',
    body: { phone },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include',
  });
}

export async function verifyOtp(challengeId: string, code: string): Promise<AuthUser> {
  const res = await apiRequest<AuthTokenResponse>('/api/auth/otp/verify', {
    method: 'POST',
    body: { challengeId, code },
    skipAuth: true,
    noRefresh: true,
    credentials: 'include', // receive the HttpOnly refresh cookie
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
