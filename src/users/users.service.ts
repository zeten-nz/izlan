import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationRepository } from '../authorization/authorization.repository';
import { AccountUnavailableError, DuplicatePhoneError } from '../common/errors';
import { normalizeUzPhone } from './phone.util';
import { UsersRepository } from './users.repository';

/** Accepted system role kodlari (TD-27). */
export const SYSTEM_ROLE = {
  LEARNER: 'LEARNER',
  METHODIST: 'METHODIST',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: UsersRepository,
    private readonly authz: AuthorizationRepository,
  ) {}

  findById(userId: string) {
    return this.repo.findById(userId);
  }

  /** Auth response bootstrap (§25/39) — faqat xavfsiz maydonlar (phone/DOB/permission YO'Q). */
  async getAuthBootstrap(userId: string): Promise<{ id: string; onboardingCompleted: boolean }> {
    const user = await this.repo.findByIdWithProfile(userId);
    if (!user) throw new AccountUnavailableError('user not found');
    return { id: user.id, onboardingCompleted: Boolean(user.profile?.onboardingCompletedAt) };
  }

  findByPhone(rawPhone: string) {
    return this.repo.findByCanonicalPhone(normalizeUzPhone(rawPhone));
  }

  /**
   * Verified-phone'dan keyin Learner yaratish (§6). OTP'ni O'ZI verify QILMAYDI —
   * contract: caller phone verification muvaffaqiyatiga mas'ul.
   * Atomik: User + UserProfile + default LEARNER UserRole. Phone unique race-safe (DB constraint).
   * Boshqa rol (METHODIST/MODERATOR/ADMIN) avtomatik berilmaydi.
   */
  async createLearnerAfterVerifiedPhone(rawPhone: string): Promise<User> {
    const phone = normalizeUzPhone(rawPhone);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await this.repo.createUser(phone, tx);
        await this.repo.createProfile(user.id, tx);
        const role = await this.authz.findRoleByCode(SYSTEM_ROLE.LEARNER, tx);
        if (!role) throw new Error('LEARNER role not bootstrapped — run system role seed first');
        await this.authz.assignRole(user.id, role.id, null, tx);
        return user;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Phone unique violation → silent duplicate account YO'Q (§6).
        throw new DuplicatePhoneError('phone already registered');
      }
      throw e;
    }
  }

  /**
   * Account state (§35/36): ACTIVE → auth allowed; SUSPENDED/DEACTIVATED → denied.
   * DEACTIVATED reactivation policy OPEN — bu yerda hal qilinmaydi.
   * Onboarding holati auth'ga ta'sir qilmaydi (§37) — INCOMPLETE user ham session ola oladi.
   */
  async assertAuthAllowed(userId: string): Promise<User> {
    const user = await this.repo.findById(userId);
    if (!user) throw new AccountUnavailableError('user not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountUnavailableError(`account not active: ${user.status}`);
    }
    return user;
  }

  /** Stamp lastLoginAt on a successful authentication (TD-252). Best-effort; never blocks the login response. */
  async recordLogin(userId: string): Promise<void> {
    await this.repo.updateLastLogin(userId);
  }
}
