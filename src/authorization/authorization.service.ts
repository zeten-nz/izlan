import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from './authorization.repository';

/**
 * AuthorizationService — server-side effective permission resolution (§9, TD-26/D-33).
 * Ko'p rol union + dedup. `if (role === 'ADMIN')` hard-code YO'Q — faqat permission tekshiruvi.
 * Cache YO'Q (§9) — Redis premature. User status alohida tekshiriladi (UsersService).
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly repo: AuthorizationRepository) {}

  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const rows = await this.repo.findUserRolePermissions(userId);
    const perms = new Set<string>();
    for (const { role } of rows) {
      for (const p of role.permissions) perms.add(p.permissionCode);
    }
    return perms;
  }

  async hasPermission(userId: string, code: string): Promise<boolean> {
    return (await this.getEffectivePermissions(userId)).has(code);
  }

  async hasAllPermissions(userId: string, codes: readonly string[]): Promise<boolean> {
    const perms = await this.getEffectivePermissions(userId);
    return codes.every((c) => perms.has(c));
  }
}
