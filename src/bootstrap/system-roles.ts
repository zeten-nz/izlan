import { AuthorizationRepository } from '../authorization/authorization.repository';
import { CONTENT_AUTHOR, CONTENT_PUBLISH, CONTENT_SUBJECT_MANAGE } from '../content-authoring/content-authoring.constants';
import { ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH } from '../assessment-authoring/assessment-authoring.constants';

/**
 * System role bootstrap (§7, TD-27). Faqat role identity — demo user YO'Q.
 * Idempotent (upsert): qayta ishga tushirish xavfsiz; mavjud role code destructive overwrite qilinmaydi.
 */
export const SYSTEM_ROLES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'LEARNER', name: 'Learner' },
  { code: 'METHODIST', name: 'Methodist' },
  { code: 'MODERATOR', name: 'Moderator' },
  { code: 'ADMIN', name: 'Admin' },
];

/**
 * Default role → permission mapping (Phase 2.2A-1, TD-247). Additive + idempotent (createMany skipDuplicates) —
 * existing RolePermission rows are NEVER destructively removed. ADMIN succeeds via EXPLICIT permission rows, not a
 * role-name bypass. LEARNER/MODERATOR intentionally receive no content permissions.
 */
export const SYSTEM_ROLE_PERMISSIONS: ReadonlyArray<{ roleCode: string; permissions: readonly string[] }> = [
  // MVP self-publish (TD-250): METHODIST holds both content.author + content.publish, and the analogous
  // assessment.author + assessment.publish. SubjectAssignment is still required for every mutation — there is no
  // role-name bypass; an ADMIN without an assignment cannot author/publish content OR assessments.
  { roleCode: 'METHODIST', permissions: [CONTENT_AUTHOR, CONTENT_PUBLISH, ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH] },
  { roleCode: 'ADMIN', permissions: [CONTENT_AUTHOR, CONTENT_PUBLISH, CONTENT_SUBJECT_MANAGE, ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH] },
  { roleCode: 'MODERATOR', permissions: [] },
  { roleCode: 'LEARNER', permissions: [] },
];

export async function bootstrapSystemRoles(authz: AuthorizationRepository): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await authz.upsertRole(role.code, role.name);
  }
  for (const { roleCode, permissions } of SYSTEM_ROLE_PERMISSIONS) {
    if (permissions.length === 0) continue;
    const role = await authz.findRoleByCode(roleCode);
    if (role) await authz.ensureRolePermissions(role.id, permissions);
  }
}
