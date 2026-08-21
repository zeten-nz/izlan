import { registerPermissions } from '../authorization/permission-registry';

/**
 * Phase 2.1K — terminal-reopen recovery permissions. Internal/admin-only (TD-230), distinct from the finalization
 * recovery permissions (§25 — no accidental cross-authority). Ops-managed (no bootstrap grant, no migration).
 */
export const PAYMENT_REOPEN_READ = 'payments.reopen.read'; // GET reopen backlog (read-only)
export const PAYMENT_REOPEN_RECONCILE = 'payments.reopen.reconcile'; // POST bounded reopen reconcile

registerPermissions([PAYMENT_REOPEN_READ, PAYMENT_REOPEN_RECONCILE]);
