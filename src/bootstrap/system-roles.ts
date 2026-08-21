import { AuthorizationRepository } from '../authorization/authorization.repository';

/**
 * System role bootstrap (§7, TD-27). Faqat role identity — demo user/content/permission matrix YO'Q.
 * Idempotent (upsert): qayta ishga tushirish xavfsiz; mavjud role code destructive overwrite qilinmaydi.
 */
export const SYSTEM_ROLES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'LEARNER', name: 'Learner' },
  { code: 'METHODIST', name: 'Methodist' },
  { code: 'MODERATOR', name: 'Moderator' },
  { code: 'ADMIN', name: 'Admin' },
];

export async function bootstrapSystemRoles(authz: AuthorizationRepository): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await authz.upsertRole(role.code, role.name);
  }
}
