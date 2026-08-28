import { Injectable } from '@nestjs/common';
import {
  BlueprintBindingRole,
  ContainerStatus,
  ContentReviewOutcome,
  Prisma,
  RevisionStatus,
  SkillContributionRole,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from '../content-authoring/optimistic-concurrency';
import { CONTENT_QUALITY_POLICY_CODE, DEFAULT_CONTENT_QUALITY_POLICY_CONFIG } from './point-authoring.constants';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const REQUIRED_EVIDENCE_KINDS = ['controlled-production', 'free-production'];

/**
 * Persistence for V2 Roadmap Point authoring. Mirrors the canonical provisioner write-sequence (point +
 * revision + blueprint(+revision, stages, bindings) + mastery(+revision, gates)) but authors DRAFT revisions the
 * publish step promotes. Circular published/current pointers are always: create identity (NULL pointer) → create
 * revision → update pointer. Published revisions are immutable — an edit creates a NEW draft revision.
 */
@Injectable()
export class PointAuthoringRepository {
  constructor(private readonly prisma: PrismaService) {}
  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  // ── Subject resolution (always from DB chain — IDOR-safe) ──
  async subjectForLevel(levelId: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const level = await this.db(tx).level.findUnique({ where: { id: levelId }, select: { track: { select: { subjectId: true } } } });
    return level?.track.subjectId ?? null;
  }
  async subjectForPoint(pointId: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const point = await this.db(tx).roadmapPoint.findUnique({ where: { id: pointId }, select: { level: { select: { track: { select: { subjectId: true } } } } } });
    return point?.level.track.subjectId ?? null;
  }
  async subjectForPointRevision(revisionId: string, tx?: Prisma.TransactionClient): Promise<{ subjectId: string; pointId: string } | null> {
    const rev = await this.db(tx).roadmapPointRevision.findUnique({
      where: { id: revisionId },
      select: { roadmapPointId: true, point: { select: { level: { select: { track: { select: { subjectId: true } } } } } } },
    });
    if (!rev) return null;
    return { subjectId: rev.point.level.track.subjectId, pointId: rev.roadmapPointId };
  }
  async subjectForBlueprintRevision(revisionId: string, tx?: Prisma.TransactionClient): Promise<{ subjectId: string; pointId: string } | null> {
    const rev = await this.db(tx).teachingBlueprintRevision.findUnique({
      where: { id: revisionId },
      select: { blueprint: { select: { roadmapPointId: true, point: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } },
    });
    if (!rev) return null;
    return { subjectId: rev.blueprint.point.level.track.subjectId, pointId: rev.blueprint.roadmapPointId };
  }
  async subjectForMasteryRevision(revisionId: string, tx?: Prisma.TransactionClient): Promise<{ subjectId: string; pointId: string } | null> {
    const rev = await this.db(tx).masteryRequirementRevision.findUnique({
      where: { id: revisionId },
      select: { requirement: { select: { roadmapPointId: true, point: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } },
    });
    if (!rev) return null;
    return { subjectId: rev.requirement.point.level.track.subjectId, pointId: rev.requirement.roadmapPointId };
  }

  // ── Create the authoring bundle (all DRAFT) ──
  async createPointBundle(
    tx: Prisma.TransactionClient,
    input: { pointKey: string; levelId: string; createdBy: string; title: string; canDo: string[]; sortOrderDefault: number; estimatedEffortMin: number | null },
  ) {
    const point = await tx.roadmapPoint.create({ data: { pointKey: input.pointKey, levelId: input.levelId, status: ContainerStatus.DRAFT, createdBy: input.createdBy } });
    const revision = await tx.roadmapPointRevision.create({
      data: {
        roadmapPointId: point.id,
        versionNo: 1,
        status: RevisionStatus.DRAFT,
        title: input.title,
        learningOutcome: { canDo: input.canDo },
        sortOrderDefault: input.sortOrderDefault,
        requiredFlag: true,
        estimatedEffortMin: input.estimatedEffortMin,
      },
    });
    const blueprint = await tx.teachingBlueprint.create({ data: { roadmapPointId: point.id, status: ContainerStatus.DRAFT, createdBy: input.createdBy } });
    await tx.teachingBlueprintRevision.create({ data: { blueprintId: blueprint.id, versionNo: 1, status: RevisionStatus.DRAFT } });
    const mastery = await tx.masteryRequirement.create({ data: { roadmapPointId: point.id, status: ContainerStatus.DRAFT, createdBy: input.createdBy } });
    await tx.masteryRequirementRevision.create({ data: { requirementId: mastery.id, versionNo: 1, status: RevisionStatus.DRAFT, gates: {}, policyVersion: 'v2-point-mastery-v1' } });
    return point.id;
  }

  /** The single editable (DRAFT/REVIEW) revision of each aggregate for a point, or null if only PUBLISHED exists. */
  async editableRevisions(pointId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const [pointRev, bpRev, mrRev] = await Promise.all([
      db.roadmapPointRevision.findFirst({ where: { roadmapPointId: pointId, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' } }),
      db.teachingBlueprintRevision.findFirst({ where: { blueprint: { roadmapPointId: pointId }, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' } }),
      db.masteryRequirementRevision.findFirst({ where: { requirement: { roadmapPointId: pointId }, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' } }),
    ]);
    return { pointRev, bpRev, mrRev };
  }

  // ── Full authoring detail view ──
  async getDetail(pointId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const point = await db.roadmapPoint.findUnique({
      where: { id: pointId },
      select: { id: true, pointKey: true, status: true, levelId: true, publishedRevisionId: true, level: { select: { code: true, track: { select: { subjectId: true, title: true } } } } },
    });
    if (!point) return null;
    const { pointRev } = await this.editableRevisions(pointId, tx);
    // Editable revision if present, else the published one (read-only view).
    const rev = pointRev ?? (point.publishedRevisionId ? await db.roadmapPointRevision.findUnique({ where: { id: point.publishedRevisionId } }) : null);
    if (!rev) return null;

    const [skills, prereqs, blueprint, mastery, sources, issues] = await Promise.all([
      db.roadmapPointSkillExpectation.findMany({
        where: { roadmapPointRevisionId: rev.id },
        select: { role: true, skillLevelExpectationId: true, expectation: { select: { id: true, currentRevisionId: true, skill: { select: { id: true, name: true, code: true } } } } },
      }),
      db.roadmapPointPrerequisite.findMany({ where: { roadmapPointRevisionId: rev.id }, select: { prerequisitePointId: true, prerequisitePoint: { select: { pointKey: true, publishedRevision: { select: { title: true } } } } } }),
      this.blueprintDetail(pointId, tx),
      this.masteryDetail(pointId, tx),
      db.contentSourceProvenance.findMany({ where: { roadmapPointRevisionId: rev.id }, select: { id: true, claimRole: true, source: { select: { id: true, title: true, kind: true, locator: true } } } }),
      db.contentQualityIssue.findMany({ where: { roadmapPointRevisionId: rev.id }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, severityCode: true, summary: true, activityId: true, assessmentItemId: true, createdAt: true } }),
    ]);

    return {
      point: { id: point.id, pointKey: point.pointKey, status: point.status, levelId: point.levelId, levelCode: point.level.code, subjectId: point.level.track.subjectId, trackTitle: point.level.track.title, publishedRevisionId: point.publishedRevisionId },
      revision: {
        id: rev.id,
        versionNo: rev.versionNo,
        status: rev.status,
        title: rev.title,
        canDo: (rev.learningOutcome as { canDo?: string[] } | null)?.canDo ?? [],
        sortOrderDefault: rev.sortOrderDefault,
        estimatedEffortMin: rev.estimatedEffortMin,
        updatedAt: rev.updatedAt.toISOString(),
        editable: pointRev !== null,
      },
      skills: skills.map((s) => ({ skillId: s.expectation.skill.id, skillName: s.expectation.skill.name, skillCode: s.expectation.skill.code, role: s.role, expectationId: s.expectation.id })),
      prerequisites: prereqs.map((p) => ({ prerequisitePointId: p.prerequisitePointId, pointKey: p.prerequisitePoint.pointKey, title: p.prerequisitePoint.publishedRevision?.title ?? null })),
      blueprint,
      mastery,
      sources: sources.map((s) => ({ id: s.id, sourceReferenceId: s.source.id, title: s.source.title, kind: s.source.kind, locator: s.source.locator, claimRole: s.claimRole })),
      issues,
    };
  }

  private async blueprintDetail(pointId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const bp = await db.teachingBlueprint.findUnique({ where: { roadmapPointId: pointId }, select: { id: true, status: true, publishedRevisionId: true } });
    if (!bp) return null;
    const { bpRev } = await this.editableRevisions(pointId, tx);
    const revId = bpRev?.id ?? bp.publishedRevisionId;
    if (!revId) return { id: bp.id, status: bp.status, revision: null };
    const rev = await db.teachingBlueprintRevision.findUnique({ where: { id: revId }, select: { id: true, versionNo: true, status: true, updatedAt: true } });
    const stages = await db.teachingBlueprintStage.findMany({
      where: { blueprintRevisionId: revId },
      orderBy: { position: 'asc' },
      select: {
        id: true, stageKey: true, stageType: true, position: true, config: true,
        bindings: { orderBy: { position: 'asc' }, select: { id: true, activityId: true, role: true, position: true, activity: { select: { type: true, revision: { select: { lesson: { select: { contentKey: true } } } } } } } },
      },
    });
    return {
      id: bp.id,
      status: bp.status,
      revision: rev
        ? {
            id: rev.id, versionNo: rev.versionNo, status: rev.status, updatedAt: rev.updatedAt.toISOString(), editable: bpRev !== null,
            stages: stages.map((st) => ({
              id: st.id, stageKey: st.stageKey, stageType: st.stageType, position: st.position,
              title: (st.config as { title?: string } | null)?.title ?? st.stageType,
              description: (st.config as { description?: string } | null)?.description ?? '',
              bindings: st.bindings.map((b) => ({ id: b.id, activityId: b.activityId, activityType: b.activity?.type ?? null, role: b.role, position: b.position, lessonContentKey: b.activity?.revision.lesson.contentKey ?? null })),
            })),
          }
        : null,
    };
  }

  private async masteryDetail(pointId: string, tx?: Prisma.TransactionClient) {
    const db = this.db(tx);
    const mr = await db.masteryRequirement.findUnique({ where: { roadmapPointId: pointId }, select: { id: true, status: true, currentRevisionId: true } });
    if (!mr) return null;
    const { mrRev } = await this.editableRevisions(pointId, tx);
    const revId = mrRev?.id ?? mr.currentRevisionId;
    if (!revId) return { id: mr.id, status: mr.status, revision: null };
    const rev = await db.masteryRequirementRevision.findUnique({ where: { id: revId }, select: { id: true, versionNo: true, status: true, gates: true, policyVersion: true, updatedAt: true } });
    const gates = await db.masteryRequirementSkillExpectation.findMany({
      where: { requirementRevisionId: revId },
      select: { role: true, requiredEvidenceKinds: true, minIndependence: true, expectationRevision: { select: { id: true, expectation: { select: { skill: { select: { id: true, name: true } } } } } } },
    });
    return {
      id: mr.id,
      status: mr.status,
      revision: rev
        ? {
            id: rev.id, versionNo: rev.versionNo, status: rev.status, policyVersion: rev.policyVersion, updatedAt: rev.updatedAt.toISOString(), editable: mrRev !== null,
            gates: rev.gates,
            skillGates: gates.map((g) => ({ skillId: g.expectationRevision.expectation.skill.id, skillName: g.expectationRevision.expectation.skill.name, role: g.role, requiredEvidenceKinds: g.requiredEvidenceKinds, minIndependence: g.minIndependence, expectationRevisionId: g.expectationRevision.id })),
          }
        : null,
    };
  }

  // ── OCC conditional writers (advance updatedAt strictly) ──
  updatePointRevision(tx: Prisma.TransactionClient, revisionId: string, expected: Date, data: Prisma.RoadmapPointRevisionUpdateInput) {
    return tx.roadmapPointRevision.updateMany({ where: { id: revisionId, updatedAt: expected, status: RevisionStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expected) } });
  }
  touchPointRevision(tx: Prisma.TransactionClient, revisionId: string, expected: Date, targetStatus?: RevisionStatus) {
    return tx.roadmapPointRevision.updateMany({ where: { id: revisionId, updatedAt: expected }, data: { updatedAt: nextOptimisticTimestamp(expected), ...(targetStatus ? { status: targetStatus } : {}) } });
  }
  touchBlueprintRevision(tx: Prisma.TransactionClient, revisionId: string, expected: Date) {
    return tx.teachingBlueprintRevision.updateMany({ where: { id: revisionId, updatedAt: expected, status: RevisionStatus.DRAFT }, data: { updatedAt: nextOptimisticTimestamp(expected) } });
  }
  touchMasteryRevision(tx: Prisma.TransactionClient, revisionId: string, expected: Date) {
    return tx.masteryRequirementRevision.updateMany({ where: { id: revisionId, updatedAt: expected, status: RevisionStatus.DRAFT }, data: { updatedAt: nextOptimisticTimestamp(expected) } });
  }

  // ── Skill expectations (identity + published v1 revision), mirrors the provisioner ──
  async ensureExpectation(tx: Prisma.TransactionClient, skillId: string, levelId: string, publishedBy: string): Promise<{ expectationId: string; expectationRevisionId: string }> {
    const expectation = await tx.skillLevelExpectation.upsert({ where: { skillId_levelId: { skillId, levelId } }, create: { skillId, levelId }, update: {} });
    let revision = await tx.skillLevelExpectationRevision.findUnique({ where: { expectationId_versionNo: { expectationId: expectation.id, versionNo: 1 } } });
    if (!revision) {
      revision = await tx.skillLevelExpectationRevision.create({
        data: { expectationId: expectation.id, versionNo: 1, status: RevisionStatus.PUBLISHED, isIntroduced: true, isExpected: true, isAssessed: true, isRequiredForExit: true, requiredEvidenceKinds: REQUIRED_EVIDENCE_KINDS, minIndependence: 1, criticality: 1, publishedBy, publishedAt: new Date() },
      });
    }
    if (expectation.currentRevisionId !== revision.id) await tx.skillLevelExpectation.update({ where: { id: expectation.id }, data: { currentRevisionId: revision.id } });
    return { expectationId: expectation.id, expectationRevisionId: revision.id };
  }

  async replacePointSkills(tx: Prisma.TransactionClient, pointRevisionId: string, levelId: string, publishedBy: string, skills: { skillId: string; role: SkillContributionRole }[]) {
    await tx.roadmapPointSkillExpectation.deleteMany({ where: { roadmapPointRevisionId: pointRevisionId } });
    for (const s of skills) {
      const { expectationId } = await this.ensureExpectation(tx, s.skillId, levelId, publishedBy);
      await tx.roadmapPointSkillExpectation.create({ data: { roadmapPointRevisionId: pointRevisionId, skillLevelExpectationId: expectationId, role: s.role } });
    }
  }

  async replacePrerequisites(tx: Prisma.TransactionClient, pointRevisionId: string, ownerPointId: string, prerequisitePointIds: string[]) {
    await tx.roadmapPointPrerequisite.deleteMany({ where: { roadmapPointRevisionId: pointRevisionId } });
    for (const prerequisitePointId of prerequisitePointIds) {
      await tx.roadmapPointPrerequisite.create({ data: { roadmapPointRevisionId: pointRevisionId, roadmapPointId: ownerPointId, prerequisitePointId } });
    }
  }

  async replaceBlueprintStages(tx: Prisma.TransactionClient, blueprintRevisionId: string, stages: { stageKey?: string; stageType: string; title: string; description?: string; bindings: { activityId: string; role: BlueprintBindingRole }[] }[]) {
    // Delete existing stages (cascade removes bindings) then recreate ordered.
    await tx.teachingBlueprintStage.deleteMany({ where: { blueprintRevisionId } });
    let pos = 1;
    for (const st of stages) {
      const stage = await tx.teachingBlueprintStage.create({ data: { blueprintRevisionId, stageKey: st.stageKey ?? null, position: pos++, stageType: st.stageType, config: { title: st.title, description: st.description ?? '' } } });
      let bpos = 1;
      for (const b of st.bindings) await tx.teachingBlueprintContentBinding.create({ data: { blueprintStageId: stage.id, activityId: b.activityId, role: b.role, position: bpos++ } });
    }
  }

  /** OCC-guarded gates update that ALSO advances updatedAt (the caller must not separately touch the revision —
   *  a second update on the revision row would auto-bump @updatedAt and defeat the token). */
  updateMasteryGates(tx: Prisma.TransactionClient, masteryRevisionId: string, expected: Date, gates: Prisma.InputJsonValue) {
    return tx.masteryRequirementRevision.updateMany({ where: { id: masteryRevisionId, updatedAt: expected, status: RevisionStatus.DRAFT }, data: { gates, updatedAt: nextOptimisticTimestamp(expected) } });
  }

  /** Replace the mastery skill-gate CHILD rows (do not touch the revision's updatedAt — done by updateMasteryGates). */
  async replaceMasterySkillGates(tx: Prisma.TransactionClient, masteryRevisionId: string, levelId: string, publishedBy: string, skillGates: { skillId: string; role: SkillContributionRole; requiredEvidenceKinds: string[]; minIndependence: number | null }[]) {
    await tx.masteryRequirementSkillExpectation.deleteMany({ where: { requirementRevisionId: masteryRevisionId } });
    for (const g of skillGates) {
      const { expectationRevisionId } = await this.ensureExpectation(tx, g.skillId, levelId, publishedBy);
      await tx.masteryRequirementSkillExpectation.create({ data: { requirementRevisionId: masteryRevisionId, skillLevelExpectationRevisionId: expectationRevisionId, role: g.role, requiredEvidenceKinds: g.requiredEvidenceKinds, minIndependence: g.minIndependence } });
    }
  }

  /** Lock the point row (SELECT … FOR UPDATE) so concurrent publish/clone serialize (§21). */
  async lockPoint(tx: Prisma.TransactionClient, pointId: string): Promise<void> {
    await tx.$executeRaw`SELECT id FROM roadmap_point WHERE id = ${pointId}::uuid FOR UPDATE`;
  }

  /**
   * Edit-published → NEW draft revisions: clone the current PUBLISHED point/blueprint/mastery revisions into fresh
   * DRAFT revisions (versionNo+1), copying their content. Published revisions stay immutable (pinned by history).
   */
  async cloneToNewDraft(tx: Prisma.TransactionClient, pointId: string): Promise<void> {
    const point = await tx.roadmapPoint.findUniqueOrThrow({ where: { id: pointId }, select: { publishedRevisionId: true } });
    const bp = await tx.teachingBlueprint.findUniqueOrThrow({ where: { roadmapPointId: pointId }, select: { id: true, publishedRevisionId: true } });
    const mr = await tx.masteryRequirement.findUniqueOrThrow({ where: { roadmapPointId: pointId }, select: { id: true, currentRevisionId: true } });

    // Point revision clone (+ skills + prereqs).
    const oldPointRev = await tx.roadmapPointRevision.findUniqueOrThrow({ where: { id: point.publishedRevisionId! }, include: { skillExpectations: true, prerequisites: true } });
    const nextPointNo = (await tx.roadmapPointRevision.aggregate({ where: { roadmapPointId: pointId }, _max: { versionNo: true } }))._max.versionNo! + 1;
    const newPointRev = await tx.roadmapPointRevision.create({
      data: { roadmapPointId: pointId, versionNo: nextPointNo, status: RevisionStatus.DRAFT, title: oldPointRev.title, learningOutcome: (oldPointRev.learningOutcome ?? Prisma.JsonNull) as Prisma.InputJsonValue, topicId: oldPointRev.topicId, sortOrderDefault: oldPointRev.sortOrderDefault, requiredFlag: oldPointRev.requiredFlag, estimatedEffortMin: oldPointRev.estimatedEffortMin },
    });
    for (const se of oldPointRev.skillExpectations) await tx.roadmapPointSkillExpectation.create({ data: { roadmapPointRevisionId: newPointRev.id, skillLevelExpectationId: se.skillLevelExpectationId, role: se.role } });
    for (const pr of oldPointRev.prerequisites) await tx.roadmapPointPrerequisite.create({ data: { roadmapPointRevisionId: newPointRev.id, roadmapPointId: pointId, prerequisitePointId: pr.prerequisitePointId } });

    // Blueprint revision clone (+ stages + bindings).
    const oldBpRev = await tx.teachingBlueprintRevision.findUniqueOrThrow({ where: { id: bp.publishedRevisionId! }, include: { stages: { include: { bindings: true }, orderBy: { position: 'asc' } } } });
    const nextBpNo = (await tx.teachingBlueprintRevision.aggregate({ where: { blueprintId: bp.id }, _max: { versionNo: true } }))._max.versionNo! + 1;
    const newBpRev = await tx.teachingBlueprintRevision.create({ data: { blueprintId: bp.id, versionNo: nextBpNo, status: RevisionStatus.DRAFT, estimatedDurationMin: oldBpRev.estimatedDurationMin } });
    for (const st of oldBpRev.stages) {
      const stage = await tx.teachingBlueprintStage.create({ data: { blueprintRevisionId: newBpRev.id, stageKey: st.stageKey, position: st.position, stageType: st.stageType, config: (st.config ?? {}) as Prisma.InputJsonValue } });
      for (const b of st.bindings) await tx.teachingBlueprintContentBinding.create({ data: { blueprintStageId: stage.id, lessonRevisionId: b.lessonRevisionId, activityId: b.activityId, mediaAssetId: b.mediaAssetId, role: b.role, position: b.position } });
    }

    // Mastery revision clone (+ skill gates).
    const oldMrRev = await tx.masteryRequirementRevision.findUniqueOrThrow({ where: { id: mr.currentRevisionId! }, include: { skillExpectations: true } });
    const nextMrNo = (await tx.masteryRequirementRevision.aggregate({ where: { requirementId: mr.id }, _max: { versionNo: true } }))._max.versionNo! + 1;
    const newMrRev = await tx.masteryRequirementRevision.create({ data: { requirementId: mr.id, versionNo: nextMrNo, status: RevisionStatus.DRAFT, gates: (oldMrRev.gates ?? {}) as Prisma.InputJsonValue, policyVersion: oldMrRev.policyVersion } });
    for (const g of oldMrRev.skillExpectations) await tx.masteryRequirementSkillExpectation.create({ data: { requirementRevisionId: newMrRev.id, skillLevelExpectationRevisionId: g.skillLevelExpectationRevisionId, role: g.role, requiredEvidenceKinds: (g.requiredEvidenceKinds ?? []) as Prisma.InputJsonValue, minIndependence: g.minIndependence } });
  }

  /** Promote a point's REVIEW revisions to PUBLISHED + move circular pointers, archiving any prior published set. */
  async publishBundle(tx: Prisma.TransactionClient, pointId: string, pointRevId: string, bpRevId: string, mrRevId: string, publishedBy: string) {
    const point = await tx.roadmapPoint.findUniqueOrThrow({ where: { id: pointId }, select: { publishedRevisionId: true } });
    const bp = await tx.teachingBlueprint.findUniqueOrThrow({ where: { roadmapPointId: pointId }, select: { id: true, publishedRevisionId: true } });
    const mr = await tx.masteryRequirement.findUniqueOrThrow({ where: { roadmapPointId: pointId }, select: { id: true, currentRevisionId: true } });

    // Detach + archive prior published revisions (they remain, pinned by history).
    if (point.publishedRevisionId && point.publishedRevisionId !== pointRevId) {
      await tx.roadmapPoint.update({ where: { id: pointId }, data: { publishedRevisionId: null } });
      await tx.roadmapPointRevision.update({ where: { id: point.publishedRevisionId }, data: { status: RevisionStatus.ARCHIVED } });
    }
    if (bp.publishedRevisionId && bp.publishedRevisionId !== bpRevId) {
      await tx.teachingBlueprint.update({ where: { id: bp.id }, data: { publishedRevisionId: null } });
      await tx.teachingBlueprintRevision.update({ where: { id: bp.publishedRevisionId }, data: { status: RevisionStatus.ARCHIVED } });
    }
    if (mr.currentRevisionId && mr.currentRevisionId !== mrRevId) {
      await tx.masteryRequirement.update({ where: { id: mr.id }, data: { currentRevisionId: null } });
      await tx.masteryRequirementRevision.update({ where: { id: mr.currentRevisionId }, data: { status: RevisionStatus.ARCHIVED } });
    }

    const now = new Date();
    await tx.roadmapPointRevision.update({ where: { id: pointRevId }, data: { status: RevisionStatus.PUBLISHED, publishedBy, publishedAt: now } });
    await tx.teachingBlueprintRevision.update({ where: { id: bpRevId }, data: { status: RevisionStatus.PUBLISHED, publishedBy, publishedAt: now } });
    await tx.masteryRequirementRevision.update({ where: { id: mrRevId }, data: { status: RevisionStatus.PUBLISHED, publishedBy, publishedAt: now } });

    await tx.roadmapPoint.update({ where: { id: pointId }, data: { publishedRevisionId: pointRevId, status: ContainerStatus.PUBLISHED } });
    await tx.teachingBlueprint.update({ where: { id: bp.id }, data: { publishedRevisionId: bpRevId, status: ContainerStatus.PUBLISHED } });
    await tx.masteryRequirement.update({ where: { id: mr.id }, data: { currentRevisionId: mrRevId, status: ContainerStatus.PUBLISHED } });
  }

  // ── Activity validation (bindings must reference published activities in the point's subject) ──
  async publishedActivities(activityIds: string[], subjectId: string): Promise<Map<string, { type: string }>> {
    if (activityIds.length === 0) return new Map();
    const rows = await this.prisma.activity.findMany({
      where: { id: { in: activityIds }, revision: { status: RevisionStatus.PUBLISHED, lesson: { topic: { module: { level: { track: { subjectId } } } } } } },
      select: { id: true, type: true },
    });
    return new Map(rows.map((r) => [r.id, { type: r.type }]));
  }

  /** Published objective/teach activities in a subject, for the blueprint binding picker (learner-safe metadata). */
  async bindableActivities(subjectId: string) {
    const rows = await this.prisma.activity.findMany({
      where: { revision: { status: RevisionStatus.PUBLISHED, lesson: { topic: { module: { level: { track: { subjectId } } } } } } },
      orderBy: [{ revision: { lesson: { contentKey: 'asc' } } }, { position: 'asc' }],
      select: { id: true, type: true, position: true, revision: { select: { lesson: { select: { contentKey: true } } } }, skills: { select: { skill: { select: { code: true, name: true } } } } },
      take: 500,
    });
    return rows.map((a) => ({ id: a.id, type: a.type, position: a.position, lessonContentKey: a.revision.lesson.contentKey, skills: a.skills.map((s) => ({ code: s.skill.code, name: s.skill.name })) }));
  }

  // ── Sources / provenance ──
  createSource(tx: Prisma.TransactionClient, data: { title: string; kind: string; locator: string | null; metadata: Prisma.InputJsonValue | null; createdBy: string }) {
    return tx.sourceReference.create({ data: { title: data.title, kind: data.kind, locator: data.locator, metadata: data.metadata ?? Prisma.DbNull, createdBy: data.createdBy } });
  }
  attachSourceToPoint(tx: Prisma.TransactionClient, pointRevisionId: string, sourceReferenceId: string, claimRole: string, createdBy: string) {
    return tx.contentSourceProvenance.create({ data: { sourceReferenceId, roadmapPointRevisionId: pointRevisionId, claimRole, createdBy } });
  }
  sourcesForSubject(subjectId: string) {
    // Sources are subject-neutral bibliographic entities; list the ones this subject's authors created recently is out of scope — list all.
    return this.prisma.sourceReference.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, kind: true, locator: true } });
  }

  // ── Quality issues ──
  raiseIssue(tx: Prisma.TransactionClient, data: { severityCode: string; summary: string; roadmapPointRevisionId?: string; activityId?: string; assessmentItemId?: string; createdBy: string }) {
    return tx.contentQualityIssue.create({ data: { severityCode: data.severityCode, summary: data.summary, roadmapPointRevisionId: data.roadmapPointRevisionId ?? null, activityId: data.activityId ?? null, assessmentItemId: data.assessmentItemId ?? null, createdBy: data.createdBy } });
  }
  resolveIssue(tx: Prisma.TransactionClient, issueId: string, status: 'RESOLVED' | 'DISMISSED' | 'UNDER_REVIEW') {
    return tx.contentQualityIssue.update({ where: { id: issueId }, data: { status, resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? new Date() : null } });
  }
  async openBlockingIssues(pointRevisionId: string, tx?: Prisma.TransactionClient): Promise<number> {
    return this.db(tx).contentQualityIssue.count({ where: { roadmapPointRevisionId: pointRevisionId, status: { in: ['OPEN', 'UNDER_REVIEW'] }, severityCode: 'BLOCKER' } });
  }
  findIssue(issueId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).contentQualityIssue.findUnique({ where: { id: issueId }, select: { id: true, roadmapPointRevisionId: true } });
  }

  // ── Quality policy ──
  async ensureActivePolicy(tx: Prisma.TransactionClient, createdBy: string) {
    const existing = await tx.contentQualityPolicyVersion.findUnique({ where: { code: CONTENT_QUALITY_POLICY_CODE } });
    if (existing) return existing;
    try {
      return await tx.contentQualityPolicyVersion.create({ data: { code: CONTENT_QUALITY_POLICY_CODE, status: 'ACTIVE', config: DEFAULT_CONTENT_QUALITY_POLICY_CONFIG, createdBy } });
    } catch (e) {
      if (isUniqueViolation(e)) return (await tx.contentQualityPolicyVersion.findUnique({ where: { code: CONTENT_QUALITY_POLICY_CODE } }))!;
      throw e;
    }
  }

  // ── Reviews ──
  createReview(tx: Prisma.TransactionClient, data: { roadmapPointRevisionId: string; policyVersionId: string; outcome: ContentReviewOutcome; blockers: Prisma.InputJsonValue | null; notes: string | null; reviewedBy: string }) {
    return tx.contentReview.create({ data: { roadmapPointRevisionId: data.roadmapPointRevisionId, policyVersionId: data.policyVersionId, outcome: data.outcome, blockers: data.blockers ?? Prisma.DbNull, notes: data.notes, reviewedBy: data.reviewedBy } });
  }
  async latestApprovedReview(pointRevisionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).contentReview.findFirst({ where: { roadmapPointRevisionId: pointRevisionId, outcome: ContentReviewOutcome.APPROVED }, orderBy: { reviewedAt: 'desc' }, select: { id: true, reviewedBy: true, reviewedAt: true } });
  }

  // ── Provenance count (policy gate) ──
  countSources(pointRevisionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).contentSourceProvenance.count({ where: { roadmapPointRevisionId: pointRevisionId } });
  }
}
