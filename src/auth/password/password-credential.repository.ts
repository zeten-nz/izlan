import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** PasswordCredential persistence primitive (TD-252). Stores only the Argon2id encoded hash. tx-aware. */
@Injectable()
export class PasswordCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  findByUserId(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).passwordCredential.findUnique({ where: { userId } });
  }

  create(userId: string, passwordHash: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).passwordCredential.create({ data: { userId, passwordHash } });
  }

  /** Establish or replace the credential (password reset). */
  upsert(userId: string, passwordHash: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).passwordCredential.upsert({ where: { userId }, create: { userId, passwordHash }, update: { passwordHash } });
  }
}
