import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { RevisionService } from '../revision.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { CreateRevisionDto, UpdateRevisionDto } from '../dto/revision.dto';

/**
 * Staff DRAFT LessonRevision authoring (Phase 2.2A-2). content.author + SubjectAssignment (resolved via
 * Lesson→…→Subject). Version is backend authority; only DRAFT revisions are mutable. No review/publish transitions.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class RevisionsController {
  constructor(private readonly revisions: RevisionService) {}

  @Get('lessons/:lessonId/revisions')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string) {
    return this.revisions.listRevisions(p.userId, lessonId);
  }

  @Post('lessons/:lessonId/revisions')
  create(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Body() dto: CreateRevisionDto) {
    return this.revisions.createRevision(p.userId, lessonId, dto);
  }

  @Get('revisions/:revisionId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string) {
    return this.revisions.getRevision(p.userId, revisionId);
  }

  @Patch('revisions/:revisionId')
  update(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: UpdateRevisionDto) {
    return this.revisions.updateRevision(p.userId, revisionId, dto);
  }
}
