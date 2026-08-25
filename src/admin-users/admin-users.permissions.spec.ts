import { isKnownPermission } from '../authorization/permission-registry';
import {
  ADMIN_USERS_PERMISSIONS,
  USERS_READ,
  USERS_ROLES_MANAGE,
  USERS_SESSIONS_REVOKE,
  USERS_STATUS_MANAGE,
} from './admin-users.constants';
import { SYSTEM_ROLE_PERMISSIONS } from '../bootstrap/system-roles';

const permsFor = (roleCode: string) => SYSTEM_ROLE_PERMISSIONS.find((r) => r.roleCode === roleCode)?.permissions ?? [];

describe('admin users permissions + bootstrap mapping (Phase 07C1)', () => {
  it('ADMINUSERS-PERM-01 the four users.* codes are the approved catalog and are registered', () => {
    expect(USERS_READ).toBe('users.read');
    expect(USERS_STATUS_MANAGE).toBe('users.status.manage');
    expect(USERS_SESSIONS_REVOKE).toBe('users.sessions.revoke');
    expect(USERS_ROLES_MANAGE).toBe('users.roles.manage');
    for (const c of ADMIN_USERS_PERMISSIONS) expect(isKnownPermission(c)).toBe(true);
  });

  it('ADMINUSERS-PERM-02 ADMIN default seed contains ALL four users.* codes AND keeps its content codes', () => {
    const admin = permsFor('ADMIN');
    for (const c of ADMIN_USERS_PERMISSIONS) expect(admin).toContain(c);
    expect(admin).toContain('content.author');
    expect(admin).toContain('content.publish');
    expect(admin).toContain('content.subject.manage');
  });

  it('ADMINUSERS-PERM-03 METHODIST / MODERATOR / LEARNER receive NO users.* codes', () => {
    for (const role of ['METHODIST', 'MODERATOR', 'LEARNER']) {
      for (const c of ADMIN_USERS_PERMISSIONS) expect(permsFor(role)).not.toContain(c);
    }
  });

  it('ADMINUSERS-PERM-04 audit.read is NOT introduced in 07C1', () => {
    expect(isKnownPermission('audit.read')).toBe(false);
  });

  it('ADMINUSERS-PERM-05 authority is permission-code based (domain-prefixed codes, not role names)', () => {
    for (const c of ADMIN_USERS_PERMISSIONS) {
      expect(c.startsWith('users.')).toBe(true); // domain-oriented, never a role-name like "ADMIN"
      expect(['ADMIN', 'METHODIST', 'MODERATOR', 'LEARNER']).not.toContain(c);
    }
    // Every role in the seed map is authorized solely by codes it explicitly holds (no `role === 'ADMIN'` shortcut).
    for (const { permissions } of SYSTEM_ROLE_PERMISSIONS) {
      for (const code of permissions) expect(isKnownPermission(code)).toBe(true);
    }
  });
});
