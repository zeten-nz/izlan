import { Injectable } from '@nestjs/common';
import { AssessmentAttemptPurpose, AssessmentAttemptStatus, AssessmentResponseStatus, Prisma, SkillMeasurementSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface MeasurementRow {
  userId: string;
  skillId: string;
  attemptId: string;
  scoreBp: number;
  confidenceBp: number;
  evidenceCount: number; // objective response evidence units for this Skill (TD-113)
  observedAt: Date; // = attempt.completedAt (logical evidence time, TD-113)
  derivationVersion: string;
}

/**
 * Skill-profile persistence. Reads assessment evidence tables directly (one-way dependency; no Nest
 * import of AssessmentModule) and writes the derived SkillMeasurement (append-only) + LearnerSkillState
 * (mutable, chronology-guarded). No writes to assessment/response/roadmap/xp.
 */
@Injectable()
export class SkillProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /** Own, COMPLETED, INITIAL_DIAGNOSTIC attempt (null → not own/exists/completed/diagnostic → 404-safe). */
  findOwnCompletedDiagnostic(userId: string, attemptId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentAttempt.findFirst({
      where: { id: attemptId, userId, status: AssessmentAttemptStatus.COMPLETED, purpose: AssessmentAttemptPurpose.INITIAL_DIAGNOSTIC },
      select: { id: true, userId: true, subjectId: true, definitionVersionId: true, engineVersion: true, completedAt: true },
    });
  }

  findVersionConfig(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findUnique({ where: { id: versionId }, select: { config: true } });
  }

  async poolItems(versionId: string, tx?: Prisma.TransactionClient): Promise<{ itemId: string; skillId: string; difficulty: number }[]> {
    const rows = await this.db(tx).assessmentVersionItem.findMany({
      where: { versionId },
      select: { itemId: true, difficultyOverride: true, item: { select: { skillId: true, difficulty: true } } },
    });
    return rows.map((r) => ({ itemId: r.itemId, skillId: r.item.skillId, difficulty: r.difficultyOverride ?? r.item.difficulty }));
  }

  async orderedResponses(attemptId: string, tx?: Prisma.TransactionClient): Promise<{ itemId: string; isCorrect: boolean }[]> {
    const rows = await this.db(tx).assessmentResponse.findMany({
      where: { attemptId, status: AssessmentResponseStatus.SUBMITTED },
      orderBy: { sequenceNo: 'asc' },
      select: { itemId: true, isCorrect: true },
    });
    return rows.map((r) => ({ itemId: r.itemId, isCorrect: r.isCorrect === true }));
  }

  skillsByIds(skillIds: string[], tx?: Prisma.TransactionClient) {
    return this.db(tx).skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, subjectId: true } });
  }

  getSubject(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subject.findUnique({ where: { id: subjectId }, select: { id: true, title: true } });
  }

  /** Current LearnerSkillState for a subject's skills (deterministic order: sortOrder, name, id). */
  subjectSkillStates(userId: string, subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerSkillState.findMany({
      where: { userId, skill: { subjectId } },
      orderBy: [{ skill: { sortOrder: 'asc' } }, { skill: { name: 'asc' } }, { skillId: 'asc' }],
      select: {
        skillId: true,
        masteryScoreBp: true,
        confidenceBp: true,
        evidenceCount: true,
        displayLevel: true,
        lastMeasurementAt: true,
        skill: { select: { name: true } },
      },
    });
  }

  /** The diagnostic SkillMeasurement milestone for one attempt (this derivation version). */
  attemptMeasurements(attemptId: string, derivationVersion: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).skillMeasurement.findMany({
      where: { attemptId, source: SkillMeasurementSource.DIAGNOSTIC, derivationVersion },
      orderBy: [{ skill: { sortOrder: 'asc' } }, { skill: { name: 'asc' } }, { skillId: 'asc' }],
      select: { skillId: true, scoreBp: true, confidenceBp: true, displayLevel: true, createdAt: true, skill: { select: { name: true } } },
    });
  }

  /** Append-only, idempotent (ON CONFLICT DO NOTHING via skipDuplicates → no tx abort on the partial-unique).
   *  Persists the normalized merge metadata (evidenceCount + observedAt) so the merge engine never
   *  reinterprets diagnostic pedagogy (TD-113). LearnerSkillState is NOT written here — the Learning
   *  Progress Merge Engine is the single writer (TD-115); the service calls it after these rows commit. */
  createMeasurements(rows: MeasurementRow[], tx?: Prisma.TransactionClient) {
    return this.db(tx).skillMeasurement.createMany({
      data: rows.map((r) => ({
        userId: r.userId,
        skillId: r.skillId,
        source: SkillMeasurementSource.DIAGNOSTIC,
        attemptId: r.attemptId,
        scoreBp: r.scoreBp,
        confidenceBp: r.confidenceBp,
        evidenceCount: r.evidenceCount,
        observedAt: r.observedAt,
        displayLevel: null,
        derivationVersion: r.derivationVersion,
      })),
      skipDuplicates: true,
    });
  }
}
