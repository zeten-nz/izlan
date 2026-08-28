import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentLifecycleConflictError, ContentNotFoundError } from '../common/errors';
import { SubjectScopeService } from '../content-authoring/subject-scope.service';
import { ContentAuditRepository } from '../content-authoring/content-audit.repository';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { POINT_AUDIT, POINT_TARGET } from './point-authoring.constants';
import type { IntegrityScopeDto, RecordIntegrityDecisionDto } from './dto/point-authoring.dto';

/**
 * Content Quality — Evidence Integrity workflow (§35a). When a published artifact is confirmed defective, staff
 * record an immutable, versioned, SCOPED EvidenceIntegrityDecision. On INVALIDATED, the CURRENT admissibility of
 * affected evidence changes and the single-writer recompute rebuilds projections EXCLUDING it — the immutable
 * SkillMeasurement / ActivityAttempt / AssessmentResponse history is never deleted or rewritten. Content Quality
 * emits the outcome; it never writes LearnerSkillState directly (the recompute does, as the sole writer).
 */
@Injectable()
export class EvidenceIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
    private readonly learningProgress: LearningProgressService,
  ) {}

  async recordDecision(userId: string, dto: RecordIntegrityDecisionDto) {
    for (const s of dto.scopes) {
      const targets = [s.activityId, s.assessmentItemId, s.lessonRevisionId].filter(Boolean).length;
      if (targets !== 1) throw new ContentLifecycleConflictError('each scope must reference exactly one artifact');
    }

    // Idempotency by clientRequestId (staff command has no natural key).
    const existing = await this.prisma.evidenceIntegrityDecision.findFirst({ where: { clientRequestId: dto.clientRequestId } });
    if (existing) return this.view(existing.id, 0);

    // Scope authz: the actor must be assigned to the Subject of a scoped artifact (resolved from the DB chain).
    const subjectId = await this.resolveSubject(dto.scopes[0]);
    await this.scope.requireScope(userId, subjectId);

    const decisionId = await this.prisma.$transaction(async (tx) => {
      let id: string;
      try {
        const decision = await tx.evidenceIntegrityDecision.create({
          data: {
            contentQualityIssueId: dto.contentQualityIssueId ?? null,
            outcome: dto.outcome,
            policyVersion: 'content-quality-policy-v1',
            reasonCode: dto.reasonCode,
            supersedesDecisionId: dto.supersedesDecisionId ?? null,
            details: (dto.details as Prisma.InputJsonValue) ?? Prisma.DbNull,
            decidedBy: userId,
            clientRequestId: dto.clientRequestId,
          },
        });
        id = decision.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return (await tx.evidenceIntegrityDecision.findFirstOrThrow({ where: { clientRequestId: dto.clientRequestId } })).id;
        }
        throw e;
      }
      for (const s of dto.scopes) {
        await tx.evidenceIntegrityScope.create({
          data: { decisionId: id, scopeKind: s.scopeKind, activityId: s.activityId ?? null, assessmentItemId: s.assessmentItemId ?? null, lessonRevisionId: s.lessonRevisionId ?? null, scopeQualifier: (s.scopeQualifier as Prisma.InputJsonValue) ?? Prisma.DbNull },
        });
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.INTEGRITY_DECISION, targetType: POINT_TARGET.EVIDENCE_INTEGRITY_DECISION, targetId: id, metadata: { outcome: dto.outcome, reasonCode: dto.reasonCode, scopes: dto.scopes.length } });
      return id;
    });

    // Recompute affected learner projections (outside the write tx). Only INVALIDATED excludes evidence; other
    // outcomes (VALID/UNDER_REVIEW/QUALIFIED) record the decision without a blanket exclusion.
    let affected = 0;
    if (dto.outcome === 'INVALIDATED') {
      const activityIds = dto.scopes.map((s) => s.activityId).filter((x): x is string => !!x);
      const itemIds = dto.scopes.map((s) => s.assessmentItemId).filter((x): x is string => !!x);
      ({ affected } = await this.learningProgress.recomputeAffectedByArtifacts(activityIds, itemIds));
    }
    return this.view(decisionId, affected);
  }

  private async view(decisionId: string, affected: number) {
    const d = await this.prisma.evidenceIntegrityDecision.findUniqueOrThrow({
      where: { id: decisionId },
      select: { id: true, outcome: true, reasonCode: true, policyVersion: true, contentQualityIssueId: true, supersedesDecisionId: true, decidedAt: true, scopes: { select: { id: true, scopeKind: true, activityId: true, assessmentItemId: true, lessonRevisionId: true } } },
    });
    return { ...d, decidedAt: d.decidedAt.toISOString(), affectedRecomputed: affected };
  }

  private async resolveSubject(scope: IntegrityScopeDto): Promise<string | null> {
    if (scope.assessmentItemId) {
      const i = await this.prisma.assessmentItem.findUnique({ where: { id: scope.assessmentItemId }, select: { definition: { select: { subjectId: true } } } });
      return i?.definition.subjectId ?? null;
    }
    let lessonRevisionId = scope.lessonRevisionId ?? null;
    if (!lessonRevisionId && scope.activityId) {
      const a = await this.prisma.activity.findUnique({ where: { id: scope.activityId }, select: { lessonRevisionId: true } });
      lessonRevisionId = a?.lessonRevisionId ?? null;
    }
    if (lessonRevisionId) return this.subjectForLessonRevision(lessonRevisionId);
    throw new ContentNotFoundError('unresolvable scope');
  }

  private async subjectForLessonRevision(lessonRevisionId: string): Promise<string | null> {
    const rev = await this.prisma.lessonRevision.findUnique({
      where: { id: lessonRevisionId },
      select: { lesson: { select: { topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } } } },
    });
    return rev?.lesson.topic.module.level.track.subjectId ?? null;
  }
}
