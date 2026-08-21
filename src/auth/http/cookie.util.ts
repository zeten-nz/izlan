import type { FastifyReply } from 'fastify';

/**
 * Refresh cookie (§26/38). Minimal manual serialize/parse — external dependency'siz (jest CommonJS-safe).
 * HttpOnly, SameSite=Lax, Path scoped, Domain omitted (host-only). Value = opaque refresh token only.
 */
export const REFRESH_COOKIE_NAME = 'izlan_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';

function serializeCookie(name: string, value: string, opts: { path: string; maxAge: number; httpOnly: boolean; secure: boolean }): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.floor(opts.maxAge)}`,
    'SameSite=Lax',
  ];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function setRefreshCookie(reply: FastifyReply, token: string, secure: boolean, maxAgeSeconds: number): void {
  reply.header('set-cookie', serializeCookie(REFRESH_COOKIE_NAME, token, { path: REFRESH_COOKIE_PATH, maxAge: maxAgeSeconds, httpOnly: true, secure }));
}

export function clearRefreshCookie(reply: FastifyReply, secure: boolean): void {
  reply.header('set-cookie', serializeCookie(REFRESH_COOKIE_NAME, '', { path: REFRESH_COOKIE_PATH, maxAge: 0, httpOnly: true, secure }));
}

export function readRefreshCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
