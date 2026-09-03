import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from './optimistic-concurrency';

/**
 * Subject + SubjectAssignment persistence (Phase 2.2A-1). Subjects are top-level (no parent scope); assignments
 * are the scope authority for child content. unique(userId, subjectId) is the assignment authority (§8).
 */
@Injectable()
export class SubjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  // ── Subject ──
  createSubject(tx: Prisma.TransactionClient, data: { slug: string; title: string; description?: string | null; sortOrder: number; createdBy: string }) {
    return tx.subject.create({ data, select: SUBJECT_SELECT });
  }

  /**
   * Serialize concurrent sortOrder assignment with a transaction-scoped Postgres advisory lock (auto-released at
   * COMMIT/ROLLBACK). Two simultaneous creates then compute distinct next positions instead of racing on the same MAX.
   */
  async lockSubjectOrdering(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUBJECT_ORDER_LOCK_KEY})`;
  }

  /** The current maximum canonical sortOrder across ALL subjects (ordering is a global sequence), or null if none. */
  async maxSortOrder(tx: Prisma.TransactionClient): Promise<number | null> {
    const agg = await tx.subject.aggregate({ _max: { sortOrder: true } });
    return agg._max.sortOrder ?? null;
  }

  /** Ids of the subjects the actor may manage (their assigned set) — the exact set a reorder must cover. */
  async assignedSubjectIds(userId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
    const rows = await this.db(tx).subject.findMany({ where: { assignments: { some: { userId } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  setSortOrder(tx: Prisma.TransactionClient, id: string, sortOrder: number) {
    return tx.subject.update({ where: { id }, data: { sortOrder }, select: { id: true } });
  }
  findSubject(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subject.findUnique({ where: { id }, select: SUBJECT_SELECT });
  }
  /** Subjects the actor may author in (content.author scope) — those they hold an assignment for. */
  listAssignedSubjects(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subject.findMany({
      where: { assignments: { some: { userId } } },
      select: SUBJECT_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  updateSubjectConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.SubjectUpdateManyMutationInput) {
    // Strictly advance the OCC token by ≥1ms in the SAME write (TIMESTAMP(3) precision).
    return tx.subject.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  /** Subject DRAFT → PUBLISHED (Phase 2.2B); strictly advances updatedAt. */
  publishSubjectConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date) {
    return tx.subject.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { status: ContainerStatus.PUBLISHED, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── SubjectAssignment ──
  createAssignment(tx: Prisma.TransactionClient, data: { userId: string; subjectId: string; assignedBy: string }) {
    return tx.subjectAssignment.create({ data, select: ASSIGNMENT_SELECT });
  }
  findAssignment(userId: string, subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subjectAssignment.findUnique({ where: { userId_subjectId: { userId, subjectId } }, select: ASSIGNMENT_SELECT });
  }
  listAssignments(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subjectAssignment.findMany({ where: { subjectId }, select: ASSIGNMENT_SELECT, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }] });
  }
  deleteAssignment(tx: Prisma.TransactionClient, userId: string, subjectId: string) {
    return tx.subjectAssignment.deleteMany({ where: { userId, subjectId } });
  }

  userExists(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.findUnique({ where: { id }, select: { id: true } });
  }
}

/** Stable advisory-lock key for serializing global Subject sortOrder assignment (arbitrary constant, never collides). */
const SUBJECT_ORDER_LOCK_KEY = 728041007;

const SUBJECT_SELECT = { id: true, slug: true, title: true, description: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.SubjectSelect;
const ASSIGNMENT_SELECT = { id: true, userId: true, subjectId: true, assignedAt: true, assignedBy: true } satisfies Prisma.SubjectAssignmentSelect;
