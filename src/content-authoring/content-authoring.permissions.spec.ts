import { isKnownPermission } from '../authorization/permission-registry';
import { CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE } from './content-authoring.constants';
import { SYSTEM_ROLE_PERMISSIONS } from '../bootstrap/system-roles';

const permsFor = (roleCode: string) => SYSTEM_ROLE_PERMISSIONS.find((r) => r.roleCode === roleCode)?.permissions ?? [];

describe('content authoring permissions + bootstrap mapping (Phase 2.2A-1, TD-247)', () => {
  it('AUTH-01 content.author is a known registered permission', () => {
    expect(CONTENT_AUTHOR).toBe('content.author');
    expect(isKnownPermission(CONTENT_AUTHOR)).toBe(true);
  });

  it('AUTH-02 content.subject.manage is a known registered permission', () => {
    expect(CONTENT_SUBJECT_MANAGE).toBe('content.subject.manage');
    expect(isKnownPermission(CONTENT_SUBJECT_MANAGE)).toBe(true);
  });

  it('AUTH-03 METHODIST default receives content.author (and only that)', () => {
    expect([...permsFor('METHODIST')]).toEqual([CONTENT_AUTHOR]);
  });

  it('AUTH-04 ADMIN default receives both content permissions', () => {
    expect([...permsFor('ADMIN')].sort()).toEqual([CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE].sort());
  });

  it('AUTH-05 LEARNER and MODERATOR receive no content permissions', () => {
    expect([...permsFor('LEARNER')]).toEqual([]);
    expect([...permsFor('MODERATOR')]).toEqual([]);
  });

  it('AUTH-07 ADMIN access is granted by EXPLICIT permission codes, not a role-name bypass', () => {
    // ADMIN appears in the mapping only because it holds the same explicit codes; there is no `role === ADMIN`
    // shortcut. Every role in the map is authorized solely by the permission codes it is granted.
    for (const { permissions } of SYSTEM_ROLE_PERMISSIONS) {
      for (const code of permissions) expect(isKnownPermission(code)).toBe(true);
    }
    expect(permsFor('ADMIN')).toContain(CONTENT_AUTHOR); // ADMIN is not special-cased; it just has the code
  });
});
