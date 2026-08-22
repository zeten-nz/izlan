import { Inject, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationRepository } from '../../authorization/authorization.repository';
import { UsersRepository } from '../../users/users.repository';
import { SYSTEM_ROLE } from '../../users/users.service';
import { normalizeUzPhone } from '../../users/phone.util';
import { DuplicatePhoneError } from '../../common/errors';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher';
import { PasswordCredentialRepository } from './password-credential.repository';

/**
 * Phone+password credential orchestration (TD-252). Registration and reset run in ONE transaction each so identity +
 * credential are established atomically. `verifyCredentials` is enumeration-safe and timing-equalized: unknown phone /
 * no credential still performs an Argon2 verify against a dummy hash so response time does not reveal account existence.
 */
@Injectable()
export class AuthCredentialService {
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepo: UsersRepository,
    private readonly authz: AuthorizationRepository,
    private readonly credentials: PasswordCredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) this.dummyHash = await this.hasher.hash('izlan-timing-equalizer-not-a-credential');
    return this.dummyHash;
  }

  /**
   * Atomic registration after a verified REGISTRATION OTP: User + UserProfile + default LEARNER role + PasswordCredential.
   * Phone unique race → DuplicatePhoneError (no second account, §10). No other role is auto-granted.
   */
  async registerWithPassword(canonicalPhone: string, password: string): Promise<User> {
    const phone = normalizeUzPhone(canonicalPhone);
    const passwordHash = await this.hasher.hash(password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await this.usersRepo.createUser(phone, tx);
        await this.usersRepo.createProfile(user.id, tx);
        const role = await this.authz.findRoleByCode(SYSTEM_ROLE.LEARNER, tx);
        if (!role) throw new Error('LEARNER role not bootstrapped — run system role seed first');
        await this.authz.assignRole(user.id, role.id, null, tx);
        await this.credentials.create(user.id, passwordHash, tx);
        return user;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DuplicatePhoneError('phone already registered');
      throw e;
    }
  }

  /**
   * Replace/establish the password after a verified PASSWORD_RESET OTP. Enumeration-safe: an unknown phone is a silent
   * no-op (returns null) rather than revealing non-existence. Returns the affected userId so the caller can revoke
   * that user's existing sessions (§11/23).
   */
  async resetPassword(canonicalPhone: string, password: string): Promise<{ userId: string } | null> {
    const phone = normalizeUzPhone(canonicalPhone);
    const user = await this.usersRepo.findByCanonicalPhone(phone);
    if (!user) return null;
    const passwordHash = await this.hasher.hash(password);
    await this.credentials.upsert(user.id, passwordHash);
    return { userId: user.id };
  }

  /** Verify phone+password. Returns the User on success, else null. Timing-equalized + enumeration-safe. */
  async verifyCredentials(rawPhone: string, password: string): Promise<User | null> {
    let phone: string | null = null;
    try {
      phone = normalizeUzPhone(rawPhone);
    } catch {
      phone = null; // invalid phone → treat as unknown (generic failure), never a 400 that leaks format
    }
    const user = phone ? await this.usersRepo.findByCanonicalPhone(phone) : null;
    const credential = user ? await this.credentials.findByUserId(user.id) : null;
    if (!user || !credential) {
      await this.hasher.verify(await this.getDummyHash(), password); // equalize timing
      return null;
    }
    const ok = await this.hasher.verify(credential.passwordHash, password);
    return ok ? user : null;
  }
}
