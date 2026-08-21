/**
 * Strict-monotonic optimistic-concurrency token advancement (Phase 2.2A-2 review hardening of TD-247/TD-248).
 *
 * The content-authoring OCC token is the row's `updatedAt`, stored as PostgreSQL `TIMESTAMP(3)` (millisecond
 * precision). Relying on Prisma's implicit `@updatedAt` could, at the boundary, write the SAME millisecond value on a
 * successful conditional update — which would leave a stale client token still valid and allow it to succeed a second
 * time. Every conditional writer therefore sets `updatedAt = nextOptimisticTimestamp(expected)` explicitly, so a
 * successful write ALWAYS advances the token by at least 1ms:
 *
 *     nextOptimisticTimestamp(expected).getTime() > expected.getTime()
 *
 * The guarantee does NOT depend on the wall clock having advanced (or even on it moving forward): if `Date.now()`
 * equals or precedes `expected`, we still return `expected + 1ms`.
 */
export function nextOptimisticTimestamp(expected: Date): Date {
  return new Date(Math.max(Date.now(), expected.getTime() + 1));
}
