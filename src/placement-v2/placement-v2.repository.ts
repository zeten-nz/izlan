import { Injectable } from '@nestjs/common';
import {
  AssessmentAttemptPurpose,
  AssessmentAttemptStatus,
  ContainerStatus,
  PlacementValidationKind,
  PlacementValidationTargetKind,
  PointAcquisitionType,
  Prisma,
  RoadmapAvailabilityState,
  RoadmapGenerationStatus,
  SkillMeasurementSource,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface PointWithSkills {
  roadmapPointId: string;
  roadmapPointRevisionId: string;
  pointKey: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  sortOrder: number;
  requiredSkills: { skillId: string; skillCode: string | null; expectationRevisionId: string | null }[];
  prerequisitePointIds: string[];
}

export interface ProjectionPlan {
  roadmapPointId: string;
  roadmapPointRevisionId: string;
  sortOrder: number;
  availability: RoadmapAvailabilityState;
  acquisition: PointAcquisitionType | null;
}

export interface ValidatedTarget {
  roadmapPointId: string;
  roadmapPointRevisionId: string;
}

@Injectable()
export class PlacementV2Repository {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSubjectContext(subjectId: string): Promise<{ trackId: string; levelIds: string[] } | null> {
    const track = await this.prisma.track.findFirst({ where: { subjectId }, select: { id: true, levels: { select: { id: true } } } });
    if (!track) return null;
    return { trackId: track.id, levelIds: track.levels.map((l) => l.id) };
  }

  /** Published points for the subject with their required skills (id+code+current expectation revision) + prereq edges. */
  async publishedPointsWithSkills(levelIds: string[]): Promise<PointWithSkills[]> {
    if (levelIds.length === 0) return [];
    const points = await this.prisma.roadmapPoint.findMany({
      where: { levelId: { in: levelIds }, status: ContainerStatus.PUBLISHED, publishedRevisionId: { not: null } },
      select: {
        id: true,
        pointKey: true,
        publishedRevision: {
          select: {
            id: true,
            title: true,
            learningOutcome: true,
            sortOrderDefault: true,
            skillExpectations: { select: { expectation: { select: { skillId: true, currentRevisionId: true, skill: { select: { code: true } } } } } },
            prerequisites: { select: { prerequisitePointId: true } },
          },
        },
      },
    });
    return points
      .filter((p) => p.publishedRevision)
      .map((p) => ({
        roadmapPointId: p.id,
        roadmapPointRevisionId: p.publishedRevision!.id,
        pointKey: p.pointKey,
        title: p.publishedRevision!.title,
        learningOutcome: p.publishedRevision!.learningOutcome,
        sortOrder: p.publishedRevision!.sortOrderDefault,
        requiredSkills: p.publishedRevision!.skillExpectations.map((se) => ({ skillId: se.expectation.skillId, skillCode: se.expectation.skill.code, expectationRevisionId: se.expectation.currentRevisionId })),
        prerequisitePointIds: p.publishedRevision!.prerequisites.map((pr) => pr.prerequisitePointId),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.pointKey < b.pointKey ? -1 : 1));
  }

  async subjectDomains(subjectId: string): Promise<{ code: string; name: string; sortOrder: number }[]> {
    const rows = await this.prisma.subjectDomain.findMany({ where: { subjectId, status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, sortOrder: true } });
    return rows;
  }

  /** DIAGNOSTIC evidence for a completed attempt (per-skill). */
  async diagnosticMeasurements(userId: string, attemptId: string) {
    return this.prisma.skillMeasurement.findMany({
      where: { userId, attemptId, source: SkillMeasurementSource.DIAGNOSTIC },
      select: { skillId: true, scoreBp: true, confidenceBp: true, evidenceCount: true },
    });
  }

  /** IDOR-safe: own + COMPLETED + INITIAL_DIAGNOSTIC attempt, with its subject/track. */
  async findOwnCompletedDiagnostic(userId: string, attemptId: string) {
    return this.prisma.assessmentAttempt.findFirst({
      where: { id: attemptId, userId, status: AssessmentAttemptStatus.COMPLETED, purpose: AssessmentAttemptPurpose.INITIAL_DIAGNOSTIC },
      select: { id: true, subjectId: true, trackId: true, completedAt: true },
    });
  }

  async findLatestDecision(userId: string, subjectId: string) {
    return this.prisma.placementDecision.findFirst({ where: { userId, subjectId }, orderBy: { decidedAt: 'desc' } });
  }

  async findDecisionByAttemptPolicy(userId: string, attemptId: string, policyVersion: string) {
    return this.prisma.placementDecision.findFirst({ where: { userId, sourceAttemptId: attemptId, policyVersion } });
  }

  async findDecisionByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.placementDecision.findFirst({ where: { userId, clientRequestId } });
  }

  async currentGeneration(userId: string, subjectId: string) {
    return this.prisma.learnerRoadmapGeneration.findFirst({ where: { userId, subjectId, status: RoadmapGenerationStatus.CURRENT } });
  }

  async previouslyLearnedPointIds(userId: string, pointIds: string[]): Promise<Set<string>> {
    if (pointIds.length === 0) return new Set();
    const rows = await this.prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: { in: pointIds }, acquisitionType: PointAcquisitionType.LEARNED }, select: { roadmapPointId: true } });
    return new Set(rows.map((r) => r.roadmapPointId));
  }

  /**
   * Apply a placement decision atomically and idempotently: create the immutable PlacementDecision (+ point-target
   * PlacementDecisionValidation rows for validated points), supersede the CURRENT generation and create a new
   * CURRENT generation from the decision with its projections, and for each validated point write a
   * PointAcquisitionEvent(VALIDATED) + PointAcquisitionValidationRef (the exact lineage). No LessonCompletion/XP/time.
   */
  async applyPlacement(input: {
    userId: string;
    subjectId: string;
    trackId: string;
    sourceAttemptId: string | null;
    clientRequestId: string | null;
    policyVersion: string;
    applicationPolicyVersion: string;
    recommendedStudyLevelId: string | null;
    snapshot: Prisma.InputJsonValue;
    engineVersion: string;
    projections: ProjectionPlan[];
    validatedTargets: ValidatedTarget[];
  }): Promise<{ decisionId: string; generationId: string; created: boolean }> {
    // Idempotency: an existing decision for this attempt+policy (or clientRequest) short-circuits.
    const existingDecision = input.sourceAttemptId
      ? await this.findDecisionByAttemptPolicy(input.userId, input.sourceAttemptId, input.policyVersion)
      : input.clientRequestId
        ? await this.findDecisionByClientRequest(input.userId, input.clientRequestId)
        : null;
    if (existingDecision) {
      const gen = await this.prisma.learnerRoadmapGeneration.findFirst({ where: { sourcePlacementDecisionId: existingDecision.id }, orderBy: { generationNo: 'desc' } });
      if (gen) return { decisionId: existingDecision.id, generationId: gen.id, created: false };
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Immutable decision (+ prior decision supersession pointer, new->old).
      const prior = await tx.placementDecision.findFirst({ where: { userId: input.userId, subjectId: input.subjectId }, orderBy: { decidedAt: 'desc' }, select: { id: true } });
      const decision = existingDecision ?? (await tx.placementDecision.create({
        data: {
          userId: input.userId,
          subjectId: input.subjectId,
          trackId: input.trackId,
          sourceAttemptId: input.sourceAttemptId,
          clientRequestId: input.clientRequestId,
          policyVersion: input.policyVersion,
          recommendedStudyLevelId: input.recommendedStudyLevelId,
          supersedesDecisionId: prior?.id ?? null,
          snapshot: input.snapshot,
        },
      }));

      // 2. Point-target validation rows (one per validated point), pinning the exact revision.
      const validationByPoint = new Map<string, string>();
      for (const v of input.validatedTargets) {
        const row = await tx.placementDecisionValidation.create({
          data: {
            placementDecisionId: decision.id,
            targetKind: PlacementValidationTargetKind.ROADMAP_POINT,
            roadmapPointId: v.roadmapPointId,
            roadmapPointRevisionId: v.roadmapPointRevisionId,
            validationKind: PlacementValidationKind.EVIDENCE_BACKED,
            policyVersion: input.policyVersion,
          },
        });
        validationByPoint.set(v.roadmapPointId, row.id);
      }

      // 3. Supersede the CURRENT generation, create a new CURRENT sourced by this decision.
      await tx.learnerRoadmapGeneration.updateMany({ where: { userId: input.userId, subjectId: input.subjectId, status: RoadmapGenerationStatus.CURRENT }, data: { status: RoadmapGenerationStatus.SUPERSEDED } });
      const maxNo = await tx.learnerRoadmapGeneration.aggregate({ where: { userId: input.userId, subjectId: input.subjectId }, _max: { generationNo: true } });
      const generation = await tx.learnerRoadmapGeneration.create({
        data: { userId: input.userId, subjectId: input.subjectId, trackId: input.trackId, generationNo: (maxNo._max.generationNo ?? 0) + 1, engineVersion: input.engineVersion, status: RoadmapGenerationStatus.CURRENT, sourcePlacementDecisionId: decision.id },
      });
      for (const p of input.projections) {
        await tx.roadmapPointProjection.create({ data: { roadmapGenerationId: generation.id, roadmapPointId: p.roadmapPointId, roadmapPointRevisionId: p.roadmapPointRevisionId, sortOrder: p.sortOrder, availability: p.availability, acquisition: p.acquisition } });
      }

      // 4. VALIDATED acquisition events + exact validation refs (Roadmap is the sole writer).
      for (const v of input.validatedTargets) {
        const existingEvent = await tx.pointAcquisitionEvent.findFirst({ where: { userId: input.userId, roadmapPointId: v.roadmapPointId, acquisitionType: PointAcquisitionType.VALIDATED, placementDecisionId: decision.id }, select: { id: true } });
        const event = existingEvent ?? (await tx.pointAcquisitionEvent.create({
          data: { userId: input.userId, roadmapPointId: v.roadmapPointId, roadmapPointRevisionId: v.roadmapPointRevisionId, acquisitionType: PointAcquisitionType.VALIDATED, placementDecisionId: decision.id, validationApplicationPolicyVersion: input.applicationPolicyVersion, policyVersion: input.policyVersion },
        }));
        const validationId = validationByPoint.get(v.roadmapPointId);
        if (validationId) {
          await tx.pointAcquisitionValidationRef.createMany({ data: [{ pointAcquisitionEventId: event.id, placementDecisionValidationId: validationId }], skipDuplicates: true });
        }
      }

      return { decisionId: decision.id, generationId: generation.id, created: true };
    });
  }

  /** Read the decision + its validated point ids (for the result view). */
  async decisionValidatedPointIds(decisionId: string): Promise<string[]> {
    const rows = await this.prisma.placementDecisionValidation.findMany({ where: { placementDecisionId: decisionId, roadmapPointId: { not: null } }, select: { roadmapPointId: true } });
    return rows.map((r) => r.roadmapPointId!).filter(Boolean);
  }

  async recommendedLevelForSubject(levelIds: string[]): Promise<string | null> {
    return levelIds[0] ?? null;
  }

  /** CEFR code of the first level (the level a subject's A1-only diagnostic assesses). */
  async primaryLevelCode(levelIds: string[]): Promise<string | null> {
    const id = levelIds[0];
    if (!id) return null;
    const level = await this.prisma.level.findUnique({ where: { id }, select: { code: true } });
    return level?.code ?? null;
  }
}
