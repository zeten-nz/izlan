import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { PublicationService } from '../publish/publication.service';
import { CONTENT_AUTHOR, CONTENT_PUBLISH } from '../content-authoring.constants';
import { PublishRevisionDto, ReturnToDraftDto, SubmitReviewDto } from '../dto/revision-workflow.dto';
import { ArchiveLessonDto } from '../dto/lesson-archive.dto';

/**
 * Review + publication workflow (Phase 2.2B). Readiness/preview/submit-review are content.author; return-to-draft,
 * publish, and urgent Lesson takedown are content.publish. All SubjectAssignment-scoped in the service. No role bypass.
 */
@Controller('staff/content')
export class PublicationController {
  constructor(private readonly publication: PublicationService) {}

  @Get('revisions/:revisionId/readiness')
  @RequirePermissions(CONTENT_AUTHOR)
  readiness(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string) {
    return this.publication.getReadiness(p.userId, revisionId);
  }

  @Get('revisions/:revisionId/preview')
  @RequirePermissions(CONTENT_AUTHOR)
  preview(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string) {
    return this.publication.preview(p.userId, revisionId);
  }

  @Post('revisions/:revisionId/submit-review')
  @RequirePermissions(CONTENT_AUTHOR)
  submitReview(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: SubmitReviewDto) {
    return this.publication.submitReview(p.userId, revisionId, dto);
  }

  @Post('revisions/:revisionId/return-to-draft')
  @RequirePermissions(CONTENT_PUBLISH)
  returnToDraft(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: ReturnToDraftDto) {
    return this.publication.returnToDraft(p.userId, revisionId, dto);
  }

  @Post('revisions/:revisionId/publish')
  @RequirePermissions(CONTENT_PUBLISH)
  publish(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: PublishRevisionDto) {
    return this.publication.publish(p.userId, revisionId, dto);
  }

  @Post('lessons/:lessonId/archive')
  @RequirePermissions(CONTENT_PUBLISH)
  archiveLesson(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Body() dto: ArchiveLessonDto) {
    return this.publication.archiveLesson(p.userId, lessonId, dto);
  }
}
