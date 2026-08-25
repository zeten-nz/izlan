import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors';
import { normalizeUzPhone } from '../users/phone.util';
import { AdminUsersRepository } from './admin-users.repository';
import { decodeUserCursor, encodeUserCursor } from './admin-users.cursor';
import { presentDetail, presentListItem, type AdminUserDetail, type AdminUserListItem } from './admin-users.presenter';
import { USERS_LIST_DEFAULT_LIMIT, USERS_LIST_MAX_LIMIT } from './admin-users.constants';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';

export interface AdminUsersListResult {
  items: AdminUserListItem[];
  nextCursor: string | null;
}

/**
 * Admin Users READ orchestration (Phase 07C1). Builds a bounded, deterministic keyset query from safe filters and
 * returns safe projections. Search is intentionally narrow (canonical-phone exact OR display-name prefix) — never an
 * unbounded contains-everywhere scan. No mutations here (later 07C slices).
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly repo: AdminUsersRepository) {}

  async list(query: ListUsersQueryDto): Promise<AdminUsersListResult> {
    const limit = Math.min(query.limit ?? USERS_LIST_DEFAULT_LIMIT, USERS_LIST_MAX_LIMIT);
    const and: Prisma.UserWhereInput[] = [];

    if (query.status) and.push({ status: query.status });
    if (query.role) and.push({ roles: { some: { role: { code: query.role } } } });

    const q = query.q?.trim();
    if (q) {
      // Canonicalizable phone → exact (unique index). Otherwise → bounded display-name prefix. Whitespace-only → ignored.
      let phone: string | null = null;
      try {
        phone = normalizeUzPhone(q);
      } catch {
        phone = null;
      }
      and.push(phone ? { phone } : { profile: { is: { displayName: { startsWith: q, mode: 'insensitive' } } } });
    }

    if (query.cursor) {
      const c = decodeUserCursor(query.cursor); // deterministic 400 on malformed
      const createdAt = new Date(c.createdAt);
      // Keyset "after" under (createdAt DESC, id DESC): createdAt < c OR (createdAt == c AND id < c.id).
      and.push({ OR: [{ createdAt: { lt: createdAt } }, { AND: [{ createdAt }, { id: { lt: c.id } }] }] });
    }

    const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};
    const rows = await this.repo.listUsers(where, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeUserCursor(last) : null;

    return { items: page.map(presentListItem), nextCursor };
  }

  async detail(userId: string): Promise<AdminUserDetail> {
    const row = await this.repo.findDetail(userId);
    if (!row) throw new ResourceNotFoundError('user not found');
    const activeSessionCount = await this.repo.countActiveSessions(userId);
    return presentDetail(row, activeSessionCount);
  }
}
