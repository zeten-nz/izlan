import { Injectable } from '@nestjs/common';
import { RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentUniqueConflictError, MediaAltTextRequiredError } from '../common/errors';
import { toSafeMedia, type SafeMedia } from '../media/media-presenter';
import { mediaKindForMime, normalizeAltText } from '../media/media.constants';
import { ActivityMediaRepository } from './activity-media.repository';
import { ActivityRepository } from './activity.repository';
import { RevisionRepository } from './revision.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { isUniqueViolation } from './hierarchy.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { AttachActivityMediaDto, DetachActivityMediaDto } from './dto/activity-media.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();

/**
 * ActivityMedia attach/detach (media foundation). Mirrors ActivitySkill authoring: content.author + SubjectAssignment
 * (via the activity's Subject), mutates ONLY a DRAFT LessonRevision (revision-aggregate `updatedAt` OCC token), audited.
 * A PUBLISHED revision's media is immutable — attach/detach on it is CONTENT_NOT_DRAFT. Idempotent add/remove with a
 * CURRENT token is a no-op (no token advance, no audit); a stale token is 409 even for the already-final state.
 */
@Injectable()
export class ActivityMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ActivityMediaRepository,
    private readonly activities: ActivityRepository,
    private readonly revisions: RevisionRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async listActivityMedia(userId: string, activityId: string): Promise<SafeMedia[]> {
    const act = await this.activities.findActivityScoped(activityId);
    if (!act) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, act.subjectId);
    return (await this.media.listForActivity(activityId)).map((m) => toSafeMedia(m));
  }

  async attach(userId: string, activityId: string, dto: AttachActivityMediaDto): Promise<{ revisionUpdatedAt: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const act = await this.activities.findActivityScoped(activityId, tx);
        if (!act) throw new ContentNotFoundError('not found');
        await this.scope.requireScope(userId, act.subjectId, tx);
        if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('revision not draft');
        const mime = await this.media.assetMime(tx, dto.mediaAssetId);
        if (!mime) throw new ContentNotFoundError('not found');
        // Alt text is contextual to THIS attachment. Images REQUIRE meaningful alt text (accessibility); audio is optional.
        const altText = normalizeAltText(dto.altText);
        if (mediaKindForMime(mime) === 'image' && !altText) throw new MediaAltTextRequiredError('image requires alt text');
        const current = await this.revisions.currentUpdatedAt(tx, act.revisionId);
        if (!current || !sameToken(dto.expectedRevisionUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
        if (await this.media.findLink(tx, activityId, dto.mediaAssetId)) return { revisionUpdatedAt: current.toISOString() }; // idempotent
        const touched = await this.revisions.touchRevision(tx, act.revisionId, current, userId);
        if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
        const position = await this.media.nextPosition(tx, activityId);
        await this.media.createLink(tx, { activityId, mediaAssetId: dto.mediaAssetId, position, altText });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_MEDIA_ATTACH, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.revisionId, mediaAssetId: dto.mediaAssetId } });
        return { revisionUpdatedAt: (await this.revisions.currentUpdatedAt(tx, act.revisionId))!.toISOString() };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  async detach(userId: string, activityId: string, mediaAssetId: string, dto: DetachActivityMediaDto): Promise<{ revisionUpdatedAt: string }> {
    return await this.prisma.$transaction(async (tx) => {
      const act = await this.activities.findActivityScoped(activityId, tx);
      if (!act) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, act.subjectId, tx);
      if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('revision not draft');
      const current = await this.revisions.currentUpdatedAt(tx, act.revisionId);
      if (!current || !sameToken(dto.expectedRevisionUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
      if (!(await this.media.findLink(tx, activityId, mediaAssetId))) return { revisionUpdatedAt: current.toISOString() }; // idempotent no-op
      const touched = await this.revisions.touchRevision(tx, act.revisionId, current, userId);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.media.deleteLink(tx, activityId, mediaAssetId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_MEDIA_DETACH, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.revisionId, mediaAssetId } });
      return { revisionUpdatedAt: (await this.revisions.currentUpdatedAt(tx, act.revisionId))!.toISOString() };
    });
  }
}
