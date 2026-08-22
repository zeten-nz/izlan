/**
 * Learner route helpers (Phase 3.0). Post-login intent is per LOGIN PAGE, not per role:
 * learner `/login` → `/onboarding` or `/learn`; staff `/staff/login` → `/staff/content`.
 */

/** True if the string contains any whitespace or control character (code point ≤ 0x20). */
function hasUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) <= 0x20) return true;
  return false;
}

/**
 * Sanitize a `?next=` redirect target: allow ONLY a local learner path. Rejects absolute URLs, protocol-relative
 * (`//host`), backslashes, whitespace/control chars, and anything not a learner destination. Never allows an open
 * redirect. Falls back to `/learn`.
 */
export function safeLearnerNext(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/learn';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || hasUnsafeChar(next)) return '/learn';
  if (next === '/learn' || next.startsWith('/learn/') || next === '/onboarding') return next;
  return '/learn';
}

/** Where a learner should land after auth, given onboarding completion. */
export function postAuthLearnerPath(onboardingCompleted: boolean, next?: string | null): string {
  if (!onboardingCompleted) return '/onboarding';
  return safeLearnerNext(next);
}
