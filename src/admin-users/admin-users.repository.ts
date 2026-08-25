import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Admin-user read queries (Phase 07C1). EXPLICIT SELECT only — password credential, OTP, DOB, session/refresh
 * secrets and security-event payloads are NEVER selected (defence in depth vs "serialize-then-delete"). Roles and
 * profile are joined in the same query (no N+1). Bounded `take`, deterministic keyset order.
 */
const LIST_SELECT = {
  id: true,
  phone: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  profile: { select: { displayName: true, onboardingCompletedAt: true } },
  roles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

const DETAIL_SELECT = {
  id: true,
  phone: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  profile: { select: { displayName: true, onboardingCompletedAt: true } },
  roles: { select: { grantedAt: true, role: { select: { code: true } } } },
  subjectAssignments: { select: { subjectId: true, subject: { select: { title: true } } } },
} satisfies Prisma.UserSelect;

export type AdminUserListRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;
export type AdminUserDetailRow = Prisma.UserGetPayload<{ select: typeof DETAIL_SELECT }>;

@Injectable()
export class AdminUsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Bounded keyset page (caller passes limit+1 to detect "has more"). */
  listUsers(where: Prisma.UserWhereInput, takePlusOne: number): Promise<AdminUserListRow[]> {
    return this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: takePlusOne,
      select: LIST_SELECT,
    });
  }

  findDetail(id: string): Promise<AdminUserDetailRow | null> {
    return this.prisma.user.findUnique({ where: { id }, select: DETAIL_SELECT });
  }

  /** Aggregate only — never returns session ids/tokens. */
  countActiveSessions(userId: string): Promise<number> {
    return this.prisma.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  }
}
