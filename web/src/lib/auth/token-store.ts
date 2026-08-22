/**
 * Access-token store — MEMORY ONLY (merge-blocker security invariant, Phase 2.2C / TD-251).
 *
 * The access token lives ONLY in this module-level variable. It is NEVER written to localStorage,
 * sessionStorage, IndexedDB, cookies, the URL, or any persisted client store. A browser reload deliberately
 * loses it; the AuthProvider re-establishes a session via POST /api/auth/refresh (HttpOnly rotating cookie).
 * The refresh token itself is browser-managed (HttpOnly cookie) and is never readable by this code.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
