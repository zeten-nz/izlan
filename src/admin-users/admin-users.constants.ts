import { registerPermissions } from '../authorization/permission-registry';

/**
 * Users & Access admin permission codes (Phase 07C). Registered in the application permission registry at module
 * load — exactly like content.* / payments.*. RolePermission mapping is seeded in the DB by the system bootstrap
 * (idempotent). There is NO role-name bypass: ADMIN reaches these ONLY by holding the explicit codes.
 *
 * 07C1 wires only the READ endpoints (they require `users.read`). The mutation codes are registered + seeded now so
 * that later 07C slices (suspend/restore, sessions, roles) need no additional seed/schema change — but no endpoint
 * consumes them yet. `audit.read` is intentionally NOT introduced here (deferred to 07D).
 */
export const USERS_READ = 'users.read';
export const USERS_STATUS_MANAGE = 'users.status.manage';
export const USERS_SESSIONS_REVOKE = 'users.sessions.revoke';
export const USERS_ROLES_MANAGE = 'users.roles.manage';

export const ADMIN_USERS_PERMISSIONS = [USERS_READ, USERS_STATUS_MANAGE, USERS_SESSIONS_REVOKE, USERS_ROLES_MANAGE] as const;

registerPermissions(ADMIN_USERS_PERMISSIONS);

/** Bounded list limits (mirrors the payments-recovery convention). */
export const USERS_LIST_DEFAULT_LIMIT = 25;
export const USERS_LIST_MAX_LIMIT = 100;

/** Role codes accepted as READ filters (real system roles only). Read filtering ≠ assignability. */
export const LIST_ROLE_CODES = ['LEARNER', 'METHODIST', 'MODERATOR', 'ADMIN'] as const;
export type ListRoleCode = (typeof LIST_ROLE_CODES)[number];
