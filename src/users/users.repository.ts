import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * UsersRepository — identity/profile primitive'lar (§5). Arbitrary Prisma update expose qilinmaydi.
 * Har method optional transaction client qabul qiladi (§40) — atomik flow orchestration uchun.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  findById(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.findUnique({ where: { id } });
  }

  findByIdWithProfile(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.findUnique({ where: { id }, include: { profile: true } });
  }

  findByCanonicalPhone(phone: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.findUnique({ where: { phone } });
  }

  createUser(canonicalPhone: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.create({ data: { phone: canonicalPhone } });
  }

  createProfile(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).userProfile.create({ data: { userId } });
  }

  updateLastLogin(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}
