import { registerPermissions } from '../authorization/permission-registry';

/**
 * Phase 2.1H — operational recovery permissions + bounds. Internal/admin-only (TD-213). These codes must be granted to
 * an administrative role (RolePermission) for a principal to use the routes; the permission matrix stays ops-managed
 * (no bootstrap grant, no migration). `<domain>.<resource>.<action>` naming (TD-26).
 */
export const PAYMENT_FINALIZATION_READ = 'payments.finalization.read'; // GET backlog (read-only)
export const PAYMENT_FINALIZATION_RECONCILE = 'payments.finalization.reconcile'; // POST bounded reconcile

export const RECONCILE_DEFAULT_LIMIT = 50; // §6
export const RECONCILE_MAX_LIMIT = 200;

registerPermissions([PAYMENT_FINALIZATION_READ, PAYMENT_FINALIZATION_RECONCILE]); // advisory registry (TD-90)
