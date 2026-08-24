import { ApiError, NetworkError, UnauthenticatedError } from './errors';
import { getAccessToken, setAccessToken, clearAccessToken } from '../auth/token-store';

/**
 * ONE API/auth client authority (Phase 2.2C / TD-251).
 *
 * Responsibilities concentrated here so no component ever calls raw fetch:
 *  - inject the in-memory Bearer access token,
 *  - SINGLE-FLIGHT refresh: concurrent 401s share ONE POST /api/auth/refresh; each original request retries AT
 *    MOST ONCE after a successful refresh — never a refresh→retry→refresh loop, never parallel rotations,
 *  - typed JSON error parsing (throws ApiError with the backend's stable `code`),
 *  - AbortSignal passthrough,
 *  - NO automatic retry of a state-changing mutation on 409/OCC conflict (only a 401 auth retry, which is safe
 *    because a 401 is rejected before the server mutates anything).
 */

export const CSRF_HEADER = 'X-Izlan-CSRF';
const REFRESH_PATH = '/api/auth/refresh';

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  return base.replace(/\/+$/, '');
}

/**
 * Resolve the backend base URL for a real request. A MISSING/empty `NEXT_PUBLIC_API_BASE_URL` must fail VISIBLY as a
 * configuration/network error — NOT silently degrade to same-origin relative requests (which in dev would hit the web
 * dev server on :4000 instead of the backend on :3000). Under the test runner (`NODE_ENV==='test'`) an empty base is
 * allowed so fetch-mocked unit tests keep using relative paths.
 */
function resolveApiBase(): string {
  const base = apiBase();
  if (!base && process.env.NODE_ENV !== 'test') {
    throw new NetworkError('API base URL is not configured (set NEXT_PUBLIC_API_BASE_URL)');
  }
  return base;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Do not attach the Bearer access token (used for the public auth endpoints). */
  skipAuth?: boolean;
  /** Do not attempt a single-flight refresh + retry on 401 (the refresh/login calls themselves). */
  noRefresh?: boolean;
  /** Send browser-managed cookies (refresh flow). */
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
}

// ── Single-flight refresh ──
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Rotate the refresh cookie for a new access token. Concurrent callers share the SAME in-flight promise, so only
 * one POST /api/auth/refresh is ever outstanding. Returns the new access token, or null when the session is gone.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${resolveApiBase()}${REFRESH_PATH}`, {
      method: 'POST',
      credentials: 'include', // send the HttpOnly refresh cookie
      headers: { [CSRF_HEADER]: '1' }, // required custom header (not sendable cross-origin without preflight)
    });
  } catch {
    clearAccessToken();
    return null;
  }
  if (!res.ok) {
    clearAccessToken();
    return null;
  }
  const data = (await res.json().catch(() => null)) as { accessToken?: string } | null;
  const token = data?.accessToken ?? null;
  setAccessToken(token);
  return token;
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(res.status, body?.code ?? 'AUTH_ERROR', body?.message ?? res.statusText ?? 'request failed');
}

async function rawFetch(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.skipAuth && token) headers['Authorization'] = `Bearer ${token}`;
  try {
    return await fetch(`${resolveApiBase()}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: opts.credentials,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }
}

/** Perform a JSON API request. Throws ApiError on non-2xx, NetworkError on transport failure. */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts, getAccessToken());

  // 401 → single-flight refresh → retry the SAME request AT MOST ONCE (never loops).
  if (res.status === 401 && !opts.skipAuth && !opts.noRefresh) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new UnauthenticatedError();
    res = await rawFetch(path, opts, newToken);
    if (res.status === 401) throw new UnauthenticatedError(); // still 401 after refresh → give up (no loop)
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Test-only: reset the single-flight latch between cases. */
export function __resetRefreshLatchForTests(): void {
  refreshInFlight = null;
}
