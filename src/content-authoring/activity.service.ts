import { Injectable } from '@nestjs/common';
import { Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  ContentDeleteBlockedError,
  ContentEditConflictError,
  ContentNotDraftError,
  ContentNotFoundError,
  ContentReorderInvalidError,
  ContentUniqueConflictError,
} from '../common/errors';
import { ActivityRepository } from './activity.repository';
import { RevisionRepository } from './revision.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { isUniqueViolation } from './hierarchy.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentActivity } from './presenters';
import { payloadSchemaVersion, validateActivityPayloadForAuthoring } from '../content/activity/authoring-payload';
import { CreateActivityDto, DeleteActivityDto, ReorderActivitiesDto, UpdateActivityDto } from './dto/activity.dto';

const isForeignKeyViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2003' || e.code === 'P2014');

/**
 * DRAFT-revision Activity authoring (Phase 2.2A-2). The LessonRevision is the concurrency aggregate: every mutation
 * claims the DRAFT revision via `expectedRevisionUpdatedAt` (touch → updatedBy=actor + updatedAt bump) inside the same
 * transaction as the Activity write + StaffAudit, and returns the new revision `updatedAt` as the next token (§12).
 * Payload is validated by the canonical authoring dispatcher (registry-driven); staff reads expose the full payload.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivityRepository,
    private readonly revisions: RevisionRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async listActivities(userId: string, revisionId: string) {
    const rev = await this.revisions.findRevisionScoped(revisionId);
    if (!rev) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, rev.subjectId);
    return (await this.activities.listByRevision(revisionId)).map(presentActivity);
  }

  async getActivity(userId: string, activityId: string) {
    const a = await this.activities.findActivityScoped(activityId);
    if (!a) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, a.subjectId);
    return presentActivity(a); // findActivityScoped spreads the full ACTIVITY_SELECT; extra scope fields are ignored
  }

  async createActivity(userId: string, revisionId: string, dto: CreateActivityDto) {
    // Pure payload validation BEFORE any DB write (invalid/unauthorable → no row, no audit).
    const normalized = validateActivityPayloadForAuthoring(dto.type, dto.payload);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.claimRevision(tx, userId, revisionId, dto.expectedRevisionUpdatedAt);
        const activity = await this.activities.create(tx, { lessonRevisionId: revisionId, type: dto.type, position: dto.position, payload: normalized as Prisma.InputJsonValue, estimatedDurationMin: dto.estimatedDurationMin ?? null });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_CREATE, targetType: CONTENT_TARGET.ACTIVITY, targetId: activity.id, metadata: { revisionId, activityType: dto.type, position: dto.position, schemaVersion: payloadSchemaVersion(normalized) } });
        return { activity: presentActivity(activity), revisionUpdatedAt: await this.revIso(tx, revisionId) };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('position conflict'); // @@unique([revision, position])
      throw e;
    }
  }

  async updateActivity(userId: string, activityId: string, dto: UpdateActivityDto) {
    return await this.prisma.$transaction(async (tx) => {
      const act = await this.activities.findActivityScoped(activityId, tx);
      if (!act) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, act.subjectId, tx);
      if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('not draft');

      const data: Prisma.ActivityUpdateManyMutationInput = {};
      let schemaVersion: string | undefined;
      if (dto.payload !== undefined) {
        const normalized = validateActivityPayloadForAuthoring(act.type, dto.payload); // may throw → rollback (no touch/audit)
        data.payload = normalized as Prisma.InputJsonValue;
        schemaVersion = payloadSchemaVersion(normalized);
      }
      if (dto.estimatedDurationMin !== undefined) data.estimatedDurationMin = dto.estimatedDurationMin;

      const touched = await this.revisions.touchRevision(tx, act.lessonRevisionId, new Date(dto.expectedRevisionUpdatedAt), userId);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.activities.update(tx, activityId, data);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_UPDATE, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.lessonRevisionId, activityType: act.type, fields: Object.keys(data), schemaVersion } });
      return { activity: presentActivity((await this.activities.findById(activityId, tx))!), revisionUpdatedAt: await this.revIso(tx, act.lessonRevisionId) };
    });
  }

  async deleteActivity(userId: string, activityId: string, dto: DeleteActivityDto) {
    return await this.prisma.$transaction(async (tx) => {
      const act = await this.activities.findActivityScoped(activityId, tx);
      if (!act) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, act.subjectId, tx);
      if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('not draft');
      const touched = await this.revisions.touchRevision(tx, act.lessonRevisionId, new Date(dto.expectedRevisionUpdatedAt), userId);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      try {
        await this.activities.delete(tx, activityId);
      } catch (e) {
        if (isForeignKeyViolation(e)) throw new ContentDeleteBlockedError('delete blocked'); // safe conflict, no FK detail
        throw e;
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_DELETE, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.lessonRevisionId, activityType: act.type, position: act.position } });
      return { deleted: true, revisionUpdatedAt: await this.revIso(tx, act.lessonRevisionId) };
    });
  }

  /** Atomic reorder: exact-set validation + collision-safe two-step position rewrite; ONE audit event (§16). */
  async reorder(userId: string, revisionId: string, dto: ReorderActivitiesDto) {
    return await this.prisma.$transaction(async (tx) => {
      await this.claimRevision(tx, userId, revisionId, dto.expectedRevisionUpdatedAt);
      const ordered = dto.orderedActivityIds;
      const currentIds = (await this.activities.idsForRevision(tx, revisionId)).map((a) => a.id);
      const currentSet = new Set(currentIds);
      // exact set: unique, same size, no foreign, no missing
      if (new Set(ordered).size !== ordered.length) throw new ContentReorderInvalidError('duplicate id');
      if (ordered.length !== currentSet.size) throw new ContentReorderInvalidError('set mismatch');
      for (const id of ordered) if (!currentSet.has(id)) throw new ContentReorderInvalidError('unknown id');
      // collision-safe: step 1 → unique negative temporaries; step 2 → final 0..N-1 (never collides with @@unique)
      for (let i = 0; i < ordered.length; i++) await this.activities.setPosition(tx, ordered[i], -(i + 1));
      for (let i = 0; i < ordered.length; i++) await this.activities.setPosition(tx, ordered[i], i);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_REORDER, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: revisionId, metadata: { revisionId, count: ordered.length } });
      return { revisionId, orderedActivityIds: ordered, revisionUpdatedAt: await this.revIso(tx, revisionId) };
    });
  }

  /** Load + scope + DRAFT + concurrency-claim the revision (touch). Throws IDOR-safe / not-draft / conflict. */
  private async claimRevision(tx: Prisma.TransactionClient, userId: string, revisionId: string, expectedRevisionUpdatedAt: string) {
    const rev = await this.revisions.findRevisionScoped(revisionId, tx);
    if (!rev) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, rev.subjectId, tx);
    if (rev.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('not draft');
    const touched = await this.revisions.touchRevision(tx, revisionId, new Date(expectedRevisionUpdatedAt), userId);
    if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
  }

  private async revIso(tx: Prisma.TransactionClient, revisionId: string): Promise<string> {
    const at = await this.revisions.currentUpdatedAt(tx, revisionId);
    if (!at) throw new ContentNotFoundError('not found');
    return at.toISOString();
  }
}
