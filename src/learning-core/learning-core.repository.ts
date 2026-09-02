import { Injectable } from '@nestjs/common';
import {
  ActivityAttemptStatus,
  ActivityType,
  ContainerStatus,
  MasteryEvaluationOutcome,
  MediaModerationStatus,
  MediaProcessingStatus,
  PointAcquisitionType,
  Prisma,
  RevisionStatus,
  RoadmapAvailabilityState,
  SkillContributionRole,
  SignalStatus,
  SkillMeasurementSource,
  TeachingSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { REPEATED_MISTAKE_TYPE, REVIEW_DUE_TYPE, WEAK_SKILL_TYPE } from './attention/point-attention.engine';

/** Signal types that drive roadmap Attention (repair + retention). Facts live in LearnerSignal; attention derives. */
const ATTENTION_SIGNAL_TYPES = [REPEATED_MISTAKE_TYPE, WEAK_SKILL_TYPE, REVIEW_DUE_TYPE] as const;

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const TERMINAL_SESSION_STATUSES: TeachingSessionStatus[] = [TeachingSessionStatus.COMPLETED, TeachingSessionStatus.ABANDONED];

export interface PublishedPointRow {
  pointId: string;
  pointRevisionId: string;
  pointKey: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  sortOrder: number;
  estimatedEffortMin: number | null;
  teachable: boolean; // has published blueprint revision + current mastery requirement revision
}

export interface TeachablePoint {
  pointId: string;
  pointRevisionId: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  blueprintRevisionId: string;
  masteryRequirementRevisionId: string;
  requiredSkills: { skillId: string; expectationRevisionId: string }[];
  masteryGates: Prisma.JsonValue;
}

export interface BoundActivity {
  activityId: string;
  lessonRevisionId: string;
  type: ActivityType;
  position: number;
  payload: Prisma.JsonValue;
  /** Ordered READY media attached to the activity (id = MediaAsset id) — the audio stimulus for listening activities. */
  media: { id: string; mimeType: string; altText: string | null }[];
  stageId: string;
  stageType?: string;
}

/** Only READY, non-blocked attachments reach the learner — the session serves the exact pinned media. */
const ACTIVITY_MEDIA_SELECT = {
  where: { media: { processingStatus: MediaProcessingStatus.READY, moderationStatus: { not: MediaModerationStatus.BLOCKED } } },
  orderBy: { position: 'asc' },
  select: { mediaAssetId: true, altText: true, media: { select: { mimeType: true } } },
} satisfies Prisma.ActivityMediaFindManyArgs;

function mapActivityMedia(media: { mediaAssetId: string; altText: string | null; media: { mimeType: string } }[]): { id: string; mimeType: string; altText: string | null }[] {
  return media.map((m) => ({ id: m.mediaAssetId, mimeType: m.media.mimeType, altText: m.altText }));
}

@Injectable()
export class LearningCoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient | PrismaService {
    return tx ?? this.prisma;
  }

  // ── Subject / level resolution ────────────────────────────────────────────
  async findSubjectTrack(subjectId: string): Promise<{ trackId: string; levelIds: string[] } | null> {
    const track = await this.prisma.track.findFirst({ where: { subjectId }, select: { id: true, levels: { select: { id: true } } } });
    if (!track) return null;
    return { trackId: track.id, levelIds: track.levels.map((l) => l.id) };
  }

  /** Published RoadmapPoints for a subject (across its track's levels), ordered by the revision default order. */
  async listPublishedPoints(levelIds: string[]): Promise<PublishedPointRow[]> {
    if (levelIds.length === 0) return [];
    const points = await this.prisma.roadmapPoint.findMany({
      where: { levelId: { in: levelIds }, status: ContainerStatus.PUBLISHED, publishedRevisionId: { not: null } },
      select: {
        id: true,
        pointKey: true,
        publishedRevisionId: true,
        publishedRevision: { select: { id: true, title: true, learningOutcome: true, sortOrderDefault: true, estimatedEffortMin: true } },
        teachingBlueprint: { select: { publishedRevisionId: true } },
        masteryRequirement: { select: { currentRevisionId: true } },
      },
    });
    const rows: PublishedPointRow[] = points
      .filter((p) => p.publishedRevision)
      .map((p) => ({
        pointId: p.id,
        pointRevisionId: p.publishedRevision!.id,
        pointKey: p.pointKey,
        title: p.publishedRevision!.title,
        learningOutcome: p.publishedRevision!.learningOutcome,
        sortOrder: p.publishedRevision!.sortOrderDefault,
        estimatedEffortMin: p.publishedRevision!.estimatedEffortMin,
        teachable: Boolean(p.teachingBlueprint?.publishedRevisionId && p.masteryRequirement?.currentRevisionId),
      }));
    return rows.sort((a, b) => a.sortOrder - b.sortOrder || (a.pointKey < b.pointKey ? -1 : 1));
  }

  /** Full teachable-point resolution (published blueprint revision + current mastery requirement + required skills). */
  async getTeachablePoint(pointId: string): Promise<TeachablePoint | null> {
    const point = await this.prisma.roadmapPoint.findFirst({
      where: { id: pointId, status: ContainerStatus.PUBLISHED, publishedRevisionId: { not: null } },
      select: {
        id: true,
        publishedRevisionId: true,
        publishedRevision: {
          select: {
            id: true,
            title: true,
            learningOutcome: true,
            skillExpectations: {
              where: { role: SkillContributionRole.REQUIRED },
              select: { expectation: { select: { id: true, skillId: true, currentRevisionId: true } } },
            },
          },
        },
        teachingBlueprint: { select: { publishedRevisionId: true } },
        masteryRequirement: { select: { currentRevisionId: true, currentRevision: { select: { id: true, gates: true } } } },
      },
    });
    if (!point || !point.publishedRevision || !point.teachingBlueprint?.publishedRevisionId || !point.masteryRequirement?.currentRevision) {
      return null;
    }
    const requiredSkills = point.publishedRevision.skillExpectations
      .filter((se) => se.expectation.currentRevisionId)
      .map((se) => ({ skillId: se.expectation.skillId, expectationRevisionId: se.expectation.currentRevisionId! }));
    return {
      pointId: point.id,
      pointRevisionId: point.publishedRevision.id,
      title: point.publishedRevision.title,
      learningOutcome: point.publishedRevision.learningOutcome,
      blueprintRevisionId: point.teachingBlueprint.publishedRevisionId,
      masteryRequirementRevisionId: point.masteryRequirement.currentRevision.id,
      requiredSkills,
      masteryGates: point.masteryRequirement.currentRevision.gates,
    };
  }

  // ── Roadmap generation / projection ───────────────────────────────────────
  async findCurrentGeneration(userId: string, subjectId: string) {
    return this.prisma.learnerRoadmapGeneration.findFirst({
      where: { userId, subjectId, status: 'CURRENT' },
    });
  }

  async maxGenerationNo(userId: string, subjectId: string): Promise<number> {
    const row = await this.prisma.learnerRoadmapGeneration.aggregate({ where: { userId, subjectId }, _max: { generationNo: true } });
    return row._max.generationNo ?? 0;
  }

  /** Create a CURRENT generation + projections for the given published points, atomically. */
  async createGeneration(userId: string, subjectId: string, trackId: string, engineVersion: string, points: PublishedPointRow[]) {
    const nextNo = (await this.maxGenerationNo(userId, subjectId)) + 1;
    return this.prisma.$transaction(async (tx) => {
      const generation = await tx.learnerRoadmapGeneration.create({
        data: { userId, subjectId, trackId, generationNo: nextNo, engineVersion, status: 'CURRENT' },
      });
      for (const p of points) {
        await tx.roadmapPointProjection.create({
          data: {
            roadmapGenerationId: generation.id,
            roadmapPointId: p.pointId,
            roadmapPointRevisionId: p.pointRevisionId,
            sortOrder: p.sortOrder,
            availability: p.teachable ? RoadmapAvailabilityState.AVAILABLE : RoadmapAvailabilityState.CONTENT_UNAVAILABLE,
          },
        });
      }
      return generation;
    });
  }

  /**
   * Regenerate: supersede the learner's CURRENT generation and create a NEW CURRENT one over the current published
   * point set (mirrors the placement re-decision path). Old generation stays historical (SUPERSEDED, kept for
   * audit); acquisitions survive because PointAcquisitionEvent is keyed to the STABLE point, not any generation.
   * Never rewrites history — this is the "publish → new learner generation" integration (ROADMAP_ENGINE_V2 §29).
   */
  async regenerate(userId: string, subjectId: string, trackId: string, engineVersion: string, points: PublishedPointRow[], supersedesGenerationId: string) {
    const nextNo = (await this.maxGenerationNo(userId, subjectId)) + 1;
    return this.prisma.$transaction(async (tx) => {
      await tx.learnerRoadmapGeneration.updateMany({ where: { userId, subjectId, status: 'CURRENT' }, data: { status: 'SUPERSEDED' } });
      const generation = await tx.learnerRoadmapGeneration.create({
        data: { userId, subjectId, trackId, generationNo: nextNo, engineVersion, status: 'CURRENT', supersedesGenerationId },
      });
      for (const p of points) {
        await tx.roadmapPointProjection.create({
          data: {
            roadmapGenerationId: generation.id,
            roadmapPointId: p.pointId,
            roadmapPointRevisionId: p.pointRevisionId,
            sortOrder: p.sortOrder,
            availability: p.teachable ? RoadmapAvailabilityState.AVAILABLE : RoadmapAvailabilityState.CONTENT_UNAVAILABLE,
          },
        });
      }
      return generation;
    });
  }

  async getProjections(generationId: string) {
    return this.prisma.roadmapPointProjection.findMany({
      where: { roadmapGenerationId: generationId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        roadmapPointId: true,
        roadmapPointRevisionId: true,
        sortOrder: true,
        acquisition: true,
        availability: true,
        attention: true,
        pointRevision: {
          select: {
            title: true,
            learningOutcome: true,
            estimatedEffortMin: true,
            prerequisites: { select: { prerequisitePointId: true } },
            skillExpectations: { where: { role: SkillContributionRole.REQUIRED }, select: { expectation: { select: { skillId: true } } } },
          },
        },
        point: { select: { pointKey: true } },
      },
    });
  }

  /**
   * Active repair/retention signals for the learner in a subject, as (skillId → active types). Used to derive
   * point Attention at read time — the LearnerSignal rows are the facts; the roadmap only projects over them.
   */
  async activeAttentionSignals(userId: string, subjectId: string): Promise<Map<string, string[]>> {
    const rows = await this.prisma.learnerSignal.findMany({
      where: { userId, subjectId, status: SignalStatus.ACTIVE, skillId: { not: null }, type: { in: [...ATTENTION_SIGNAL_TYPES] } },
      select: { skillId: true, type: true },
    });
    const map = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.skillId) continue;
      map.set(r.skillId, [...(map.get(r.skillId) ?? []), r.type]);
    }
    return map;
  }

  /** Current competence state for the given skills (for the read-time retention/review-due policy). */
  async skillStatesForAttention(
    userId: string,
    skillIds: string[],
  ): Promise<Map<string, { masteryScoreBp: number; confidenceBp: number | null; evidenceCount: number; lastMeasurementAt: Date | null }>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.prisma.learnerSkillState.findMany({
      where: { userId, skillId: { in: skillIds } },
      select: { skillId: true, masteryScoreBp: true, confidenceBp: true, evidenceCount: true, lastMeasurementAt: true },
    });
    return new Map(rows.map((r) => [r.skillId, { masteryScoreBp: r.masteryScoreBp, confidenceBp: r.confidenceBp, evidenceCount: r.evidenceCount, lastMeasurementAt: r.lastMeasurementAt }]));
  }

  /**
   * Resolve a point-scoped review target for the V2 review flow: the encountered lesson + revision for `skillId`
   * within the point's published blueprint. Gate: the learner must have ACQUIRED the point (review is for
   * established knowledge) and `skillId` must be one the point's blueprint actually teaches. Own-user; returns
   * null (→ caller 404s) when not acquired / not mapped — never leaks another user's or an unrelated point.
   */
  async resolvePointReviewTarget(
    userId: string,
    pointId: string,
    skillId: string,
  ): Promise<{ subjectId: string; lessonId: string; lessonRevisionId: string } | null> {
    const acquired = await this.prisma.pointAcquisitionEvent.findFirst({ where: { userId, roadmapPointId: pointId }, select: { id: true } });
    if (!acquired) return null; // review is for established (acquired) knowledge

    const skill = await this.prisma.skill.findUnique({ where: { id: skillId }, select: { subjectId: true } });
    if (!skill) return null;

    const blueprint = await this.prisma.teachingBlueprint.findUnique({ where: { roadmapPointId: pointId }, select: { publishedRevisionId: true } });
    if (!blueprint?.publishedRevisionId) return null;

    // A bound activity in the point's published blueprint that carries this skill → its (encountered) lesson revision.
    const binding = await this.prisma.teachingBlueprintContentBinding.findFirst({
      where: { stage: { blueprintRevisionId: blueprint.publishedRevisionId }, activity: { skills: { some: { skillId } } } },
      orderBy: { position: 'asc' },
      select: { activity: { select: { lessonRevisionId: true, revision: { select: { lessonId: true } } } } },
    });
    if (!binding?.activity) return null;
    return { subjectId: skill.subjectId, lessonId: binding.activity.revision.lessonId, lessonRevisionId: binding.activity.lessonRevisionId };
  }

  /** Skill display names for the given ids (for the learner-facing attention reason — never engine jargon). */
  async skillNames(skillIds: string[]): Promise<Map<string, string>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Authoritative acquisition overlay: which of these points the user has a LEARNED event for. */
  async learnedPointIds(userId: string, pointIds: string[]): Promise<Set<string>> {
    if (pointIds.length === 0) return new Set();
    const rows = await this.prisma.pointAcquisitionEvent.findMany({
      where: { userId, roadmapPointId: { in: pointIds }, acquisitionType: PointAcquisitionType.LEARNED },
      select: { roadmapPointId: true },
    });
    return new Set(rows.map((r) => r.roadmapPointId));
  }

  /** Latest acquisition kind per point from the authoritative event log (LEARNED preferred over VALIDATED). */
  async acquisitionByPoint(userId: string, pointIds: string[]): Promise<Map<string, PointAcquisitionType>> {
    if (pointIds.length === 0) return new Map();
    const rows = await this.prisma.pointAcquisitionEvent.findMany({
      where: { userId, roadmapPointId: { in: pointIds } },
      select: { roadmapPointId: true, acquisitionType: true },
    });
    const map = new Map<string, PointAcquisitionType>();
    for (const r of rows) {
      const prev = map.get(r.roadmapPointId);
      if (prev === PointAcquisitionType.LEARNED) continue; // LEARNED wins
      map.set(r.roadmapPointId, r.acquisitionType);
    }
    return map;
  }

  async setProjectionAcquisition(generationId: string, pointId: string, acquisition: PointAcquisitionType): Promise<void> {
    await this.prisma.roadmapPointProjection.updateMany({
      where: { roadmapGenerationId: generationId, roadmapPointId: pointId },
      data: { acquisition, availability: RoadmapAvailabilityState.AVAILABLE },
    });
  }

  async activeSessionIdForPoints(userId: string, pointIds: string[]): Promise<Map<string, string>> {
    if (pointIds.length === 0) return new Map();
    const rows = await this.prisma.teachingSession.findMany({
      where: { userId, roadmapPointId: { in: pointIds }, status: { notIn: TERMINAL_SESSION_STATUSES } },
      select: { id: true, roadmapPointId: true },
    });
    return new Map(rows.map((r) => [r.roadmapPointId, r.id]));
  }

  // ── Teaching session lifecycle ────────────────────────────────────────────
  async findNonTerminalSession(userId: string, pointId: string) {
    return this.prisma.teachingSession.findFirst({
      where: { userId, roadmapPointId: pointId, status: { notIn: TERMINAL_SESSION_STATUSES } },
    });
  }

  async findOwnSession(userId: string, sessionId: string) {
    return this.prisma.teachingSession.findFirst({ where: { id: sessionId, userId } });
  }

  /** Create a session pinning the point + blueprint revisions and the resolved content-revision set. */
  async createSession(userId: string, point: TeachablePoint, contentLessonRevisionIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.teachingSession.create({
        data: {
          userId,
          roadmapPointId: point.pointId,
          roadmapPointRevisionId: point.pointRevisionId,
          blueprintRevisionId: point.blueprintRevisionId,
          status: TeachingSessionStatus.TEACHING,
          startedAt: new Date(),
        },
      });
      for (const lessonRevisionId of [...new Set(contentLessonRevisionIds)]) {
        await tx.teachingSessionContentPin.create({ data: { teachingSessionId: session.id, lessonRevisionId } });
      }
      return session;
    });
  }

  async markSessionCompleted(sessionId: string): Promise<void> {
    await this.prisma.teachingSession.updateMany({
      where: { id: sessionId, status: { notIn: TERMINAL_SESSION_STATUSES } },
      data: { status: TeachingSessionStatus.COMPLETED, completedAt: new Date() },
    });
  }

  async updateSessionStatus(sessionId: string, status: TeachingSessionStatus, currentStep?: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.teachingSession.updateMany({
      where: { id: sessionId, status: { notIn: TERMINAL_SESSION_STATUSES } },
      data: { status, ...(currentStep !== undefined ? { currentStep } : {}) },
    });
  }

  // ── Blueprint stages / bound activities ───────────────────────────────────
  async getStagesWithActivities(blueprintRevisionId: string): Promise<{
    stages: { id: string; position: number; stageType: string; config: Prisma.JsonValue }[];
    bindings: (BoundActivity & { role: string; bindingPosition: number })[];
  }> {
    const stages = await this.prisma.teachingBlueprintStage.findMany({
      where: { blueprintRevisionId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        position: true,
        stageType: true,
        config: true,
        bindings: {
          where: { activityId: { not: null } },
          orderBy: { position: 'asc' },
          select: {
            role: true,
            position: true,
            activity: { select: { id: true, lessonRevisionId: true, type: true, position: true, payload: true, media: ACTIVITY_MEDIA_SELECT } },
          },
        },
      },
    });
    const bindings: (BoundActivity & { role: string; bindingPosition: number })[] = [];
    for (const s of stages) {
      for (const b of s.bindings) {
        if (!b.activity) continue;
        bindings.push({
          stageId: s.id,
          role: b.role,
          bindingPosition: b.position,
          activityId: b.activity.id,
          lessonRevisionId: b.activity.lessonRevisionId,
          type: b.activity.type,
          position: b.activity.position,
          payload: b.activity.payload,
          media: mapActivityMedia(b.activity.media),
        });
      }
    }
    return { stages: stages.map((s) => ({ id: s.id, position: s.position, stageType: s.stageType, config: s.config })), bindings };
  }

  /** Verify the activity belongs to this session's pinned blueprint revision; returns it or null. */
  async findBoundActivity(blueprintRevisionId: string, activityId: string): Promise<BoundActivity | null> {
    const binding = await this.prisma.teachingBlueprintContentBinding.findFirst({
      where: { activityId, stage: { blueprintRevisionId } },
      select: { blueprintStageId: true, stage: { select: { stageType: true } }, activity: { select: { id: true, lessonRevisionId: true, type: true, position: true, payload: true, media: ACTIVITY_MEDIA_SELECT } } },
    });
    if (!binding?.activity) return null;
    return {
      stageId: binding.blueprintStageId,
      stageType: binding.stage.stageType,
      activityId: binding.activity.id,
      lessonRevisionId: binding.activity.lessonRevisionId,
      type: binding.activity.type,
      position: binding.activity.position,
      payload: binding.activity.payload,
      media: mapActivityMedia(binding.activity.media),
    };
  }

  /** Skills each mastery activity is attributed to (ActivitySkill). */
  async activitySkillIds(activityIds: string[]): Promise<Map<string, string[]>> {
    if (activityIds.length === 0) return new Map();
    const rows = await this.prisma.activitySkill.findMany({ where: { activityId: { in: activityIds } }, select: { activityId: true, skillId: true } });
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.activityId, [...(map.get(r.activityId) ?? []), r.skillId]);
    return map;
  }

  // ── Activity attempts (append-only, idempotent) ───────────────────────────
  async findAttemptByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.activityAttempt.findFirst({ where: { userId, clientRequestId } });
  }

  async maxAttemptNo(userId: string, activityId: string): Promise<number> {
    const row = await this.prisma.activityAttempt.aggregate({ where: { userId, activityId }, _max: { attemptNo: true } });
    return row._max.attemptNo ?? 0;
  }

  createAttempt(data: {
    userId: string;
    activityId: string;
    lessonRevisionId: string;
    teachingSessionId: string;
    attemptNo: number;
    answer: Prisma.InputJsonValue;
    isCorrect: boolean;
    deterministicScore: number;
    clientRequestId: string;
  }) {
    return this.prisma.activityAttempt.create({
      data: {
        userId: data.userId,
        activityId: data.activityId,
        lessonRevisionId: data.lessonRevisionId,
        teachingSessionId: data.teachingSessionId,
        attemptNo: data.attemptNo,
        status: ActivityAttemptStatus.EVALUATED,
        answer: data.answer,
        isCorrect: data.isCorrect,
        deterministicScore: data.deterministicScore,
        clientRequestId: data.clientRequestId,
        submittedAt: new Date(),
      },
    });
  }

  /** All the learner's attempts in this session (for progress + best-score derivation). */
  async sessionAttempts(userId: string, sessionId: string) {
    return this.prisma.activityAttempt.findMany({
      where: { userId, teachingSessionId: sessionId },
      select: { id: true, activityId: true, deterministicScore: true, isCorrect: true, attemptNo: true, submittedAt: true },
    });
  }

  /** Subject that owns a roadmap point (point -> level -> track -> subject), for projection scoping. */
  async subjectIdForPoint(pointId: string): Promise<string | null> {
    const row = await this.prisma.roadmapPoint.findUnique({
      where: { id: pointId },
      select: { level: { select: { track: { select: { subjectId: true } } } } },
    });
    return row?.level.track.subjectId ?? null;
  }

  // ── Evidence + mastery + acquisition (the LEARNED lineage) ─────────────────
  /**
   * Append one TEACHING_MASTERY SkillMeasurement per skill (idempotent via the teaching partial-unique) +
   * SkillMeasurementEvidenceRef rows to the contributing attempts, in one transaction. Returns the measurement
   * ids for the skills that now have evidence (freshly created or pre-existing).
   */
  async appendTeachingEvidence(input: {
    userId: string;
    teachingSessionId: string;
    source: SkillMeasurementSource;
    derivationVersion: string;
    observedAt: Date;
    // evidenceKind + independenceLevel are PER SKILL — honestly derived from the mastery activities' formats
    // (recognition@1 for choice, controlled-production@2 for structured, listening-comprehension@1).
    perSkill: { skillId: string; scoreBp: number; confidenceBp: number; evidenceCount: number; evidenceKind: string; independenceLevel: number; expectationRevisionId: string | null; attemptIds: string[] }[];
  }): Promise<{ skillId: string; measurementId: string }[]> {
    return this.prisma.$transaction(async (tx) => {
      const result: { skillId: string; measurementId: string }[] = [];
      for (const s of input.perSkill) {
        // Idempotent append: unique on (teaching_session_id, skill_id, source, derivation_version).
        await tx.skillMeasurement.createMany({
          data: [{
            userId: input.userId,
            skillId: s.skillId,
            source: input.source,
            teachingSessionId: input.teachingSessionId,
            scoreBp: s.scoreBp,
            confidenceBp: s.confidenceBp,
            evidenceCount: s.evidenceCount,
            observedAt: input.observedAt,
            derivationVersion: input.derivationVersion,
            evidenceKind: s.evidenceKind,
            independenceLevel: s.independenceLevel,
            expectationRevisionId: s.expectationRevisionId,
          }],
          skipDuplicates: true,
        });
        const measurement = await tx.skillMeasurement.findFirst({
          where: { userId: input.userId, skillId: s.skillId, source: input.source, teachingSessionId: input.teachingSessionId, derivationVersion: input.derivationVersion },
          select: { id: true },
        });
        if (!measurement) continue;
        result.push({ skillId: s.skillId, measurementId: measurement.id });
        // Evidence refs to the contributing attempts (idempotent per (measurement, attempt)).
        for (const attemptId of [...new Set(s.attemptIds)]) {
          await tx.skillMeasurementEvidenceRef.createMany({
            data: [{ skillMeasurementId: measurement.id, activityAttemptId: attemptId }],
            skipDuplicates: true,
          });
        }
      }
      return result;
    });
  }

  /**
   * Create the MasteryEvaluation + its exact MasteryEvaluationEvidence rows (idempotent via the evaluation
   * idempotency unique on (user, point, requirementRev, cutoff)). Returns the evaluation id + whether it was new.
   */
  async recordMasteryEvaluation(input: {
    userId: string;
    roadmapPointId: string;
    roadmapPointRevisionId: string;
    requirementRevisionId: string;
    outcome: MasteryEvaluationOutcome;
    policyVersion: string;
    evidenceCutoffAt: Date;
    gateSummary: Prisma.InputJsonValue;
    measurementIds: string[];
  }): Promise<{ evaluationId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.masteryEvaluation.findFirst({
        where: {
          userId: input.userId,
          roadmapPointId: input.roadmapPointId,
          requirementRevisionId: input.requirementRevisionId,
          evidenceCutoffAt: input.evidenceCutoffAt,
        },
        select: { id: true },
      });
      if (existing) return { evaluationId: existing.id };
      const evaluation = await tx.masteryEvaluation.create({
        data: {
          userId: input.userId,
          roadmapPointId: input.roadmapPointId,
          roadmapPointRevisionId: input.roadmapPointRevisionId,
          requirementRevisionId: input.requirementRevisionId,
          outcome: input.outcome,
          policyVersion: input.policyVersion,
          evidenceCutoffAt: input.evidenceCutoffAt,
          gateSummary: input.gateSummary,
        },
      });
      for (const skillMeasurementId of [...new Set(input.measurementIds)]) {
        await tx.masteryEvaluationEvidence.create({ data: { masteryEvaluationId: evaluation.id, skillMeasurementId } });
      }
      return { evaluationId: evaluation.id };
    });
  }

  /** Idempotently create the LEARNED acquisition event (cause-based unique on (user, point, evaluation)). */
  async recordLearnedAcquisition(input: {
    userId: string;
    roadmapPointId: string;
    roadmapPointRevisionId: string;
    masteryEvaluationId: string;
    policyVersion: string;
  }): Promise<{ acquisitionId: string; created: boolean }> {
    try {
      const event = await this.prisma.pointAcquisitionEvent.create({
        data: {
          userId: input.userId,
          roadmapPointId: input.roadmapPointId,
          roadmapPointRevisionId: input.roadmapPointRevisionId,
          acquisitionType: PointAcquisitionType.LEARNED,
          masteryEvaluationId: input.masteryEvaluationId,
          policyVersion: input.policyVersion,
        },
      });
      return { acquisitionId: event.id, created: true };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const existing = await this.prisma.pointAcquisitionEvent.findFirst({
          where: { userId: input.userId, roadmapPointId: input.roadmapPointId, masteryEvaluationId: input.masteryEvaluationId },
          select: { id: true },
        });
        if (existing) return { acquisitionId: existing.id, created: false };
      }
      throw e;
    }
  }

  async findLatestEvaluation(userId: string, roadmapPointId: string) {
    return this.prisma.masteryEvaluation.findFirst({
      where: { userId, roadmapPointId },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async hasLearnedAcquisition(userId: string, roadmapPointId: string): Promise<boolean> {
    const row = await this.prisma.pointAcquisitionEvent.findFirst({
      where: { userId, roadmapPointId, acquisitionType: PointAcquisitionType.LEARNED },
      select: { id: true },
    });
    return Boolean(row);
  }

  outcomeEnum = MasteryEvaluationOutcome;
  revisionStatusEnum = RevisionStatus;
}
