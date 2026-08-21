import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentNotFoundError } from '../common/errors';

/**
 * Subject scope authority (Phase 2.2A-1, §6/17). The SECOND authorization dimension on top of the generic
 * PermissionsGuard: `content.author` alone is not enough — the actor must ALSO hold a SubjectAssignment for the
 * Subject the target content resolves to. The Subject is ALWAYS resolved from DB relationships, never trusted
 * from the client. There is NO ADMIN role-name bypass — an ADMIN authoring inside a Subject needs an assignment.
 *
 * IDOR-safe (§17): a missing entity and an out-of-scope entity are indistinguishable to the caller — both raise
 * ContentNotFoundError. We never reveal that a resource exists in another Subject.
 */
@Injectable()
export class SubjectScopeService {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  async hasAssignment(userId: string, subjectId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const a = await this.db(tx).subjectAssignment.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
      select: { id: true },
    });
    return a !== null;
  }

  /** Enforce content.author subject scope. `subjectId === null` means the parent/entity was not found. */
  async requireScope(userId: string, subjectId: string | null, tx?: Prisma.TransactionClient): Promise<string> {
    if (subjectId === null) throw new ContentNotFoundError('not found');
    if (!(await this.hasAssignment(userId, subjectId, tx))) throw new ContentNotFoundError('not found');
    return subjectId;
  }
}
