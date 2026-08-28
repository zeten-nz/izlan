import { Injectable } from '@nestjs/common';
import { ContentReviewOutcome, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  ContentEditConflictError,
  ContentLifecycleConflictError,
  ContentNotDraftError,
  ContentNotFoundError,
  ContentPublishNotReadyError,
  ContentReviewNotReadyError,
} from '../common/errors';
import { SubjectScopeService } from '../content-authoring/subject-scope.service';
import { ContentAuditRepository } from '../content-authoring/content-audit.repository';
import { PointAuthoringRepository } from './point-authoring.repository';
import { PointReadinessService, type PointReadinessReport } from './point-readiness.service';
import { POINT_AUDIT, POINT_TARGET } from './point-authoring.constants';
import type {
  AttachSourceDto, CreatePointDto, CreateSourceDto, PublishPointDto, RaiseIssueDto, ResolveIssueDto, ReturnPointToDraftDto,
  ReviewPointDto, SetBlueprintStagesDto, SetMasteryDto, SetPointPrerequisitesDto, SetPointSkillsDto, SubmitPointReviewDto, UpdatePointRevisionDto,
} from './dto/point-authoring.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();

/**
 * V2 Roadmap Point authoring orchestration. Two-dimension authz on every op: the controller requires the generic
 * content.author / content.publish permission; here `SubjectScopeService.requireScope` re-resolves the Subject
 * from the DB chain and enforces the actor's SubjectAssignment (IDOR-safe 404, no ADMIN bypass). Every mutation is
 * co-committed with a StaffAudit row. Published revisions are immutable — editing published content clones a new
 * DRAFT revision; publish promotes the DRAFT/REVIEW set and moves the circular pointers.
 */
@Injectable()
export class PointAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PointAuthoringRepository,
    private readonly readiness: PointReadinessService,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  // ── Reads ──
  async getPoint(userId: string, pointId: string) {
    const subjectId = await this.repo.subjectForPoint(pointId);
    await this.scope.requireScope(userId, subjectId);
    const detail = await this.repo.getDetail(pointId);
    if (!detail) throw new ContentNotFoundError('not found');
    return detail;
  }

  async listPoints(userId: string, levelId: string) {
    const subjectId = await this.repo.subjectForLevel(levelId);
    await this.scope.requireScope(userId, subjectId);
    const points = await this.prisma.roadmapPoint.findMany({
      where: { levelId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, pointKey: true, status: true, publishedRevision: { select: { title: true } }, revisions: { where: { status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' }, take: 1, select: { title: true, status: true } } },
    });
    return points.map((p) => ({ id: p.id, pointKey: p.pointKey, status: p.status, title: p.revisions[0]?.title ?? p.publishedRevision?.title ?? p.pointKey, editableStatus: p.revisions[0]?.status ?? null }));
  }

  async listBindableActivities(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    return this.repo.bindableActivities(subjectId);
  }

  /** Subject skills for the mapping picker (scoped). */
  async listSubjectSkills(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    return this.prisma.skill.findMany({ where: { subjectId, status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, code: true } });
  }

  /** Levels of a subject for the point-studio landing (scoped). */
  async listLevels(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    return this.prisma.level.findMany({ where: { track: { subjectId } }, orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, title: true, status: true, track: { select: { title: true } } } });
  }

  async getReadiness(userId: string, pointId: string): Promise<PointReadinessReport> {
    const subjectId = await this.repo.subjectForPoint(pointId);
    await this.scope.requireScope(userId, subjectId);
    const policy = await this.policyConfig();
    const report = await this.readiness.evaluate(pointId, { requireApprovedReview: policy.requireApprovedReview, requireSourceForPoint: policy.requireSourceForPoint });
    if (!report) throw new ContentNotFoundError('not found');
    return report;
  }

  // ── Create / edit draft ──
  async createPoint(userId: string, levelId: string, dto: CreatePointDto) {
    const pointId = await this.prisma.$transaction(async (tx) => {
      const subjectId = await this.repo.subjectForLevel(levelId, tx);
      await this.scope.requireScope(userId, subjectId, tx);
      let id: string;
      try {
        id = await this.repo.createPointBundle(tx, { pointKey: dto.pointKey, levelId, createdBy: userId, title: dto.title, canDo: dto.canDo ?? [], sortOrderDefault: dto.sortOrderDefault, estimatedEffortMin: dto.estimatedEffortMin ?? null });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ContentLifecycleConflictError('pointKey already exists');
        throw e;
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_CREATE, targetType: POINT_TARGET.ROADMAP_POINT, targetId: id, metadata: { pointKey: dto.pointKey, levelId } });
      return id;
    });
    return (await this.repo.getDetail(pointId))!;
  }

  async createDraftFromPublished(userId: string, pointId: string) {
    await this.prisma.$transaction(async (tx) => {
      const subjectId = await this.repo.subjectForPoint(pointId, tx);
      await this.scope.requireScope(userId, subjectId, tx);
      await this.repo.lockPoint(tx, pointId);
      const point = await tx.roadmapPoint.findUnique({ where: { id: pointId }, select: { publishedRevisionId: true } });
      if (!point?.publishedRevisionId) throw new ContentLifecycleConflictError('point has no published revision to revise');
      const { pointRev } = await this.repo.editableRevisions(pointId, tx);
      if (pointRev) throw new ContentLifecycleConflictError('an editable draft already exists');
      await this.repo.cloneToNewDraft(tx, pointId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_REVISION_CREATE, targetType: POINT_TARGET.ROADMAP_POINT, targetId: pointId, metadata: {} });
    });
    return (await this.repo.getDetail(pointId))!;
  }

  async updatePointRevision(userId: string, revisionId: string, dto: UpdatePointRevisionDto) {
    const pointId = await this.mutatePointRevision(userId, revisionId, dto.expectedUpdatedAt, POINT_AUDIT.POINT_REVISION_UPDATE, async (tx) => {
      const data: Prisma.RoadmapPointRevisionUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.canDo !== undefined) data.learningOutcome = { canDo: dto.canDo };
      if (dto.sortOrderDefault !== undefined) data.sortOrderDefault = dto.sortOrderDefault;
      if (dto.estimatedEffortMin !== undefined) data.estimatedEffortMin = dto.estimatedEffortMin;
      const res = await this.repo.updatePointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt), data);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
    });
    return (await this.repo.getDetail(pointId))!;
  }

  async setPointSkills(userId: string, revisionId: string, dto: SetPointSkillsDto) {
    const pointId = await this.mutatePointRevision(userId, revisionId, dto.expectedUpdatedAt, POINT_AUDIT.POINT_SKILLS_SET, async (tx, ctx) => {
      await this.repo.replacePointSkills(tx, revisionId, ctx.levelId, userId, dto.skills);
      const res = await this.repo.touchPointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt));
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
    });
    return (await this.repo.getDetail(pointId))!;
  }

  async setPointPrerequisites(userId: string, revisionId: string, dto: SetPointPrerequisitesDto) {
    const pointId = await this.mutatePointRevision(userId, revisionId, dto.expectedUpdatedAt, POINT_AUDIT.POINT_PREREQS_SET, async (tx, ctx) => {
      for (const pre of dto.prerequisitePointIds) {
        if (pre === ctx.pointId) throw new ContentLifecycleConflictError('a point cannot be its own prerequisite');
        if (await this.wouldCycle(tx, ctx.pointId, pre)) throw new ContentLifecycleConflictError('prerequisite would create a cycle');
      }
      await this.repo.replacePrerequisites(tx, revisionId, ctx.pointId, dto.prerequisitePointIds);
      const res = await this.repo.touchPointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt));
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
    });
    return (await this.repo.getDetail(pointId))!;
  }

  async setBlueprintStages(userId: string, blueprintRevisionId: string, dto: SetBlueprintStagesDto) {
    const ctx = await this.repo.subjectForBlueprintRevision(blueprintRevisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.teachingBlueprintRevision.findUnique({ where: { id: blueprintRevisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('blueprint revision is not editable');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      // Validate all bound activities are published + in the point's subject.
      const activityIds = [...new Set(dto.stages.flatMap((s) => s.bindings.map((b) => b.activityId)))];
      const published = await this.repo.publishedActivities(activityIds, ctx.subjectId);
      for (const id of activityIds) if (!published.has(id)) throw new ContentLifecycleConflictError('a bound activity is not a published activity in this subject');
      await this.repo.replaceBlueprintStages(tx, blueprintRevisionId, dto.stages);
      const res = await this.repo.touchBlueprintRevision(tx, blueprintRevisionId, new Date(dto.expectedUpdatedAt));
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.BLUEPRINT_STAGES_SET, targetType: POINT_TARGET.TEACHING_BLUEPRINT_REVISION, targetId: blueprintRevisionId, metadata: { pointId: ctx.pointId, stages: dto.stages.length } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  async setMastery(userId: string, masteryRevisionId: string, dto: SetMasteryDto) {
    const ctx = await this.repo.subjectForMasteryRevision(masteryRevisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    const levelId = await this.levelForPoint(ctx.pointId);
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.masteryRequirementRevision.findUnique({ where: { id: masteryRevisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('mastery revision is not editable');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const gates = { thresholdBp: dto.gates.thresholdBp, minIndependence: dto.gates.minIndependence, requireAllRequiredSkills: dto.gates.requireAllRequiredSkills ?? true } as Prisma.InputJsonValue;
      const res = await this.repo.updateMasteryGates(tx, masteryRevisionId, new Date(dto.expectedUpdatedAt), gates); // guards + advances updatedAt in one write
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.repo.replaceMasterySkillGates(tx, masteryRevisionId, levelId, userId, dto.skillGates.map((g) => ({ skillId: g.skillId, role: g.role, requiredEvidenceKinds: g.requiredEvidenceKinds, minIndependence: g.minIndependence ?? null })));
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.MASTERY_SET, targetType: POINT_TARGET.MASTERY_REQUIREMENT_REVISION, targetId: masteryRevisionId, metadata: { pointId: ctx.pointId, gates: dto.skillGates.length } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  // ── Sources / provenance ──
  async createSource(userId: string, dto: CreateSourceDto) {
    // SourceReference is a subject-neutral bibliographic entity; any content.author may create one.
    return this.prisma.$transaction(async (tx) => {
      const src = await this.repo.createSource(tx, { title: dto.title, kind: dto.kind, locator: dto.locator ?? null, metadata: (dto.metadata as Prisma.InputJsonValue) ?? null, createdBy: userId });
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.SOURCE_CREATE, targetType: POINT_TARGET.SOURCE_REFERENCE, targetId: src.id, metadata: { kind: dto.kind } });
      return { id: src.id, title: src.title, kind: src.kind, locator: src.locator };
    });
  }
  listSources(userId: string) {
    return this.repo.sourcesForSubject('');
  }
  async attachSource(userId: string, pointRevisionId: string, dto: AttachSourceDto) {
    const ctx = await this.repo.subjectForPointRevision(pointRevisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: pointRevisionId }, select: { status: true } });
      if (!rev || rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('point revision is not editable');
      try {
        await this.repo.attachSourceToPoint(tx, pointRevisionId, dto.sourceReferenceId, dto.claimRole, userId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ContentLifecycleConflictError('source already attached');
        throw e;
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.SOURCE_ATTACH, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: pointRevisionId, metadata: { sourceReferenceId: dto.sourceReferenceId, claimRole: dto.claimRole } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  // ── Quality issues ──
  async raiseIssue(userId: string, dto: RaiseIssueDto) {
    if (!dto.roadmapPointRevisionId && !dto.activityId && !dto.assessmentItemId) throw new ContentLifecycleConflictError('an issue must target exactly one artifact');
    const ctx = dto.roadmapPointRevisionId ? await this.repo.subjectForPointRevision(dto.roadmapPointRevisionId) : null;
    return this.prisma.$transaction(async (tx) => {
      if (ctx) await this.scope.requireScope(userId, ctx.subjectId, tx);
      const issue = await this.repo.raiseIssue(tx, { severityCode: dto.severityCode, summary: dto.summary, roadmapPointRevisionId: dto.roadmapPointRevisionId, activityId: dto.activityId, assessmentItemId: dto.assessmentItemId, createdBy: userId });
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.ISSUE_RAISE, targetType: POINT_TARGET.CONTENT_QUALITY_ISSUE, targetId: issue.id, metadata: { severityCode: dto.severityCode } });
      return { id: issue.id, status: issue.status, severityCode: issue.severityCode, summary: issue.summary };
    });
  }
  async resolveIssue(userId: string, issueId: string, dto: ResolveIssueDto) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await this.repo.findIssue(issueId, tx);
      if (!issue) throw new ContentNotFoundError('not found');
      if (issue.roadmapPointRevisionId) {
        const ctx = await this.repo.subjectForPointRevision(issue.roadmapPointRevisionId, tx);
        await this.scope.requireScope(userId, ctx?.subjectId ?? null, tx);
      }
      const updated = await this.repo.resolveIssue(tx, issueId, dto.status);
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.ISSUE_RESOLVE, targetType: POINT_TARGET.CONTENT_QUALITY_ISSUE, targetId: issueId, metadata: { status: dto.status } });
      return { id: updated.id, status: updated.status };
    });
  }

  // ── Workflow ──
  async submitReview(userId: string, revisionId: string, dto: SubmitPointReviewDto) {
    const ctx = await this.repo.subjectForPointRevision(revisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: revisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('not a draft');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const policy = await this.policyConfig(tx);
      const report = await this.readiness.evaluate(ctx.pointId, { requireApprovedReview: false, requireSourceForPoint: policy.requireSourceForPoint }, tx);
      if (!report?.reviewReady) throw new ContentReviewNotReadyError('not review-ready');
      // DRAFT→REVIEW for all three revisions.
      const { bpRev, mrRev } = await this.repo.editableRevisions(ctx.pointId, tx);
      const p = await this.repo.touchPointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt), RevisionStatus.REVIEW);
      if (p.count === 0) throw new ContentEditConflictError('edit conflict');
      if (bpRev) await tx.teachingBlueprintRevision.update({ where: { id: bpRev.id }, data: { status: RevisionStatus.REVIEW } });
      if (mrRev) await tx.masteryRequirementRevision.update({ where: { id: mrRev.id }, data: { status: RevisionStatus.REVIEW } });
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_SUBMIT_REVIEW, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: revisionId, metadata: { pointId: ctx.pointId } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  async returnToDraft(userId: string, revisionId: string, dto: ReturnPointToDraftDto) {
    const ctx = await this.repo.subjectForPointRevision(revisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: revisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.REVIEW) throw new ContentLifecycleConflictError('not in review');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const { bpRev, mrRev } = await this.repo.editableRevisions(ctx.pointId, tx);
      await this.repo.touchPointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt), RevisionStatus.DRAFT);
      if (bpRev) await tx.teachingBlueprintRevision.update({ where: { id: bpRev.id }, data: { status: RevisionStatus.DRAFT } });
      if (mrRev) await tx.masteryRequirementRevision.update({ where: { id: mrRev.id }, data: { status: RevisionStatus.DRAFT } });
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_RETURN_DRAFT, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: revisionId, reason: dto.reason });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  /** Reviewer records a multidimensional ContentReview (the hard-blocker gate). Requires content.publish. */
  async reviewPoint(userId: string, revisionId: string, dto: ReviewPointDto) {
    const ctx = await this.repo.subjectForPointRevision(revisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: revisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.REVIEW) throw new ContentLifecycleConflictError('not in review');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const policy = await this.repo.ensureActivePolicy(tx, userId);
      const report = await this.readiness.evaluate(ctx.pointId, { requireApprovedReview: false, requireSourceForPoint: false }, tx);
      await this.repo.createReview(tx, { roadmapPointRevisionId: revisionId, policyVersionId: policy.id, outcome: dto.outcome, blockers: (report?.blockers as unknown as Prisma.InputJsonValue) ?? null, notes: dto.notes ?? null, reviewedBy: userId });
      // CHANGES_REQUESTED / BLOCKED return the whole set to DRAFT for correction.
      if (dto.outcome !== ContentReviewOutcome.APPROVED) {
        const { bpRev, mrRev } = await this.repo.editableRevisions(ctx.pointId, tx);
        await this.repo.touchPointRevision(tx, revisionId, new Date(dto.expectedUpdatedAt), RevisionStatus.DRAFT);
        if (bpRev) await tx.teachingBlueprintRevision.update({ where: { id: bpRev.id }, data: { status: RevisionStatus.DRAFT } });
        if (mrRev) await tx.masteryRequirementRevision.update({ where: { id: mrRev.id }, data: { status: RevisionStatus.DRAFT } });
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_REVIEW, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: revisionId, metadata: { outcome: dto.outcome } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  /** Publish: readiness + policy gate → promote the REVIEW set, move circular pointers. Requires content.publish. */
  async publishPoint(userId: string, revisionId: string, dto: PublishPointDto) {
    const ctx = await this.repo.subjectForPointRevision(revisionId);
    if (!ctx) throw new ContentNotFoundError('not found');
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, ctx.subjectId, tx);
      await this.repo.lockPoint(tx, ctx.pointId);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: revisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.REVIEW) throw new ContentLifecycleConflictError('not in review');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const { bpRev, mrRev } = await this.repo.editableRevisions(ctx.pointId, tx);
      if (!bpRev || !mrRev) throw new ContentPublishNotReadyError('incomplete point bundle');

      const policy = await this.policyConfig(tx);
      const report = await this.readiness.evaluate(ctx.pointId, { requireApprovedReview: policy.requireApprovedReview, requireSourceForPoint: policy.requireSourceForPoint }, tx);
      if (!report?.publishReady) throw new ContentPublishNotReadyError('not publish-ready');
      // Four-eyes (policy): the approving reviewer must differ from the publisher/author when required.
      if (policy.requireApprovedReview && policy.requireFourEyes) {
        const approved = await this.repo.latestApprovedReview(revisionId, tx);
        if (!approved || approved.reviewedBy === userId) throw new ContentPublishNotReadyError('four-eyes review required');
      }
      await this.repo.publishBundle(tx, ctx.pointId, revisionId, bpRev.id, mrRev.id, userId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: POINT_AUDIT.POINT_PUBLISH, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: revisionId, metadata: { pointId: ctx.pointId, subjectId: ctx.subjectId } });
    });
    return (await this.repo.getDetail(ctx.pointId))!;
  }

  // ── helpers ──
  private async mutatePointRevision(userId: string, revisionId: string, expectedUpdatedAt: string, actionCode: string, work: (tx: Prisma.TransactionClient, ctx: { subjectId: string; pointId: string; levelId: string }) => Promise<void>): Promise<string> {
    const base = await this.repo.subjectForPointRevision(revisionId);
    if (!base) throw new ContentNotFoundError('not found');
    const levelId = await this.levelForPoint(base.pointId);
    await this.prisma.$transaction(async (tx) => {
      await this.scope.requireScope(userId, base.subjectId, tx);
      const rev = await tx.roadmapPointRevision.findUnique({ where: { id: revisionId }, select: { status: true, updatedAt: true } });
      if (!rev) throw new ContentNotFoundError('not found');
      if (rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('point revision is not editable');
      if (!sameToken(expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      await work(tx, { subjectId: base.subjectId, pointId: base.pointId, levelId });
      await this.audit.write(tx, { actorUserId: userId, actionCode, targetType: POINT_TARGET.ROADMAP_POINT_REVISION, targetId: revisionId, metadata: { pointId: base.pointId } });
    });
    return base.pointId;
  }

  private async levelForPoint(pointId: string): Promise<string> {
    const p = await this.prisma.roadmapPoint.findUniqueOrThrow({ where: { id: pointId }, select: { levelId: true } });
    return p.levelId;
  }

  private async policyConfig(tx?: Prisma.TransactionClient): Promise<{ requireApprovedReview: boolean; requireFourEyes: boolean; requireSourceForPoint: boolean }> {
    const policy = await (tx ?? this.prisma).contentQualityPolicyVersion.findUnique({ where: { code: 'content-quality-policy-v1' }, select: { config: true } });
    const cfg = (policy?.config as Record<string, unknown> | undefined) ?? {};
    return {
      requireApprovedReview: cfg.requireApprovedReview !== false,
      requireFourEyes: cfg.requireFourEyes === true,
      requireSourceForPoint: cfg.requireSourceForPoint === true,
    };
  }

  /** Bounded prerequisite-cycle guard: does `candidate` transitively require `ownerPoint` (via published edges)? */
  private async wouldCycle(tx: Prisma.TransactionClient, ownerPointId: string, candidatePointId: string): Promise<boolean> {
    const seen = new Set<string>();
    let frontier = [candidatePointId];
    for (let depth = 0; depth < 50 && frontier.length > 0; depth++) {
      const edges = await tx.roadmapPointPrerequisite.findMany({ where: { roadmapPointId: { in: frontier } }, select: { roadmapPointId: true, prerequisitePointId: true } });
      const next: string[] = [];
      for (const e of edges) {
        if (e.prerequisitePointId === ownerPointId) return true;
        if (!seen.has(e.prerequisitePointId)) { seen.add(e.prerequisitePointId); next.push(e.prerequisitePointId); }
      }
      frontier = next;
    }
    return false;
  }
}
