import { Injectable } from '@nestjs/common';
import { AssessmentAttemptPurpose, AssessmentAttemptStatus, AssessmentResponseStatus, Prisma } from '@prisma/client';

/** Prisma unique-constraint violation (partial-unique race on start, TD-95). */
export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
import { PrismaService } from '../../database/prisma.service';

export interface CreateAttemptData {
  userId: string;
  definitionId: string;
  definitionVersionId: string;
  subjectId: string;
  trackId: string | null;
  purpose: AssessmentAttemptPurpose;
  engineVersion: string;
  engineState: Prisma.InputJsonValue;
}

const ATTEMPT_VIEW = {
  id: true,
  userId: true,
  status: true,
  definitionId: true,
  definitionVersionId: true,
  subjectId: true,
  trackId: true,
  engineVersion: true,
  engineState: true,
  resultSummary: true,
  completedAt: true,
} satisfies Prisma.AssessmentAttemptSelect;

/**
 * Attempt + response persistence. The append-only AssessmentResponse sequence is the immutable
 * evidence/backstop (§21/24); engineState is only resumable mechanics. All progression mutations
 * run inside a service-opened transaction (§47) via the optional `tx`.
 */
@Injectable()
export class AssessmentAttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /** Own attempt only (§12/53) — userId filter is the IDOR guard; caller maps null → 404. */
  findOwnAttempt(attemptId: string, userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentAttempt.findFirst({ where: { id: attemptId, userId }, select: ATTEMPT_VIEW });
  }

  /**
   * The learner's current in-progress initial diagnostic for a subject (TD-95, §7/8). Resume authority
   * is (user, subject) — NOT the current version — so a moved current pointer never repins the attempt.
   */
  findInProgressInitialDiagnostic(userId: string, subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentAttempt.findFirst({
      where: { userId, subjectId, purpose: AssessmentAttemptPurpose.INITIAL_DIAGNOSTIC, status: AssessmentAttemptStatus.IN_PROGRESS },
      select: ATTEMPT_VIEW,
    });
  }

  createAttempt(data: CreateAttemptData, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentAttempt.create({
      data: {
        userId: data.userId,
        definitionId: data.definitionId,
        definitionVersionId: data.definitionVersionId,
        subjectId: data.subjectId,
        trackId: data.trackId,
        purpose: data.purpose,
        status: AssessmentAttemptStatus.IN_PROGRESS,
        engineVersion: data.engineVersion,
        engineState: data.engineState,
      },
      select: ATTEMPT_VIEW,
    });
  }

  /** The single item currently awaiting an answer (resume anchor, §22). */
  currentPresentedResponse(attemptId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentResponse.findFirst({
      where: { attemptId, status: AssessmentResponseStatus.PRESENTED },
      orderBy: { sequenceNo: 'desc' },
      select: { id: true, itemId: true, sequenceNo: true },
    });
  }

  /** Was this item already answered? Returns the stored answer for canonical replay/conflict check (§5). */
  findSubmittedResponseForItem(attemptId: string, itemId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentResponse.findFirst({
      where: { attemptId, itemId, status: AssessmentResponseStatus.SUBMITTED },
      select: { id: true, answer: true },
    });
  }

  countResponses(attemptId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentResponse.count({ where: { attemptId } });
  }

  createPresentedResponse(attemptId: string, itemId: string, sequenceNo: number, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentResponse.create({
      data: { attemptId, itemId, sequenceNo, status: AssessmentResponseStatus.PRESENTED },
      select: { id: true, itemId: true, sequenceNo: true },
    });
  }

  /**
   * Atomically transition the presented row → SUBMITTED, guarded by status=PRESENTED so exactly
   * one concurrent submitter wins (§48). Mirrors the session-rotation `count === 1` pattern.
   * Returns the affected count; caller treats 0 as "someone else advanced" (idempotent replay).
   */
  async submitPresented(
    responseId: string,
    result: { answer: Prisma.InputJsonValue; isCorrect: boolean | null; deterministicScore: number | null; submittedAt: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const r = await this.db(tx).assessmentResponse.updateMany({
      where: { id: responseId, status: AssessmentResponseStatus.PRESENTED },
      data: {
        answer: result.answer,
        isCorrect: result.isCorrect,
        deterministicScore: result.deterministicScore,
        status: AssessmentResponseStatus.SUBMITTED,
        submittedAt: result.submittedAt,
      },
    });
    return r.count;
  }

  updateEngineState(attemptId: string, engineState: Prisma.InputJsonValue, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentAttempt.update({ where: { id: attemptId }, data: { engineState } });
  }

  completeAttempt(
    attemptId: string,
    data: { engineState: Prisma.InputJsonValue; resultSummary: Prisma.InputJsonValue; completedAt: Date },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        status: AssessmentAttemptStatus.COMPLETED,
        engineState: data.engineState,
        resultSummary: data.resultSummary,
        completedAt: data.completedAt,
      },
    });
  }

  /** Submitted responses with score + skill, for the reproducible result summary (§36). */
  listSubmittedForSummary(attemptId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentResponse.findMany({
      where: { attemptId, status: AssessmentResponseStatus.SUBMITTED },
      select: { isCorrect: true, deterministicScore: true, item: { select: { skillId: true } } },
    });
  }
}
