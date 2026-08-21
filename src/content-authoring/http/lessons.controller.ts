import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { HierarchyService } from '../hierarchy.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { CreateLessonDto, MoveLessonDto, UpdateLessonDto } from '../dto/lesson.dto';

/**
 * Staff logical-Lesson authoring (Phase 2.2A-1). content.author + subject scope. Lesson.contentKey is set on
 * create and is NOT a mutable PATCH field (§11); the accepted DRAFT Lesson → Topic move is the only reparent (§14).
 * No LessonRevision/Activity authoring here (deferred to 2.2A-2).
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class LessonsController {
  constructor(private readonly hierarchy: HierarchyService) {}

  @Post('topics/:topicId/lessons')
  create(@CurrentPrincipal() p: AuthPrincipal, @Param('topicId') topicId: string, @Body() dto: CreateLessonDto) {
    return this.hierarchy.createLesson(p.userId, topicId, dto);
  }

  @Get('topics/:topicId/lessons')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('topicId') topicId: string) {
    return this.hierarchy.listLessons(p.userId, topicId);
  }

  @Get('lessons/:id')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string) {
    return this.hierarchy.getLesson(p.userId, id);
  }

  @Patch('lessons/:id')
  update(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.hierarchy.updateLesson(p.userId, id, dto);
  }

  @Post('lessons/:id/move')
  move(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: MoveLessonDto) {
    return this.hierarchy.moveLesson(p.userId, id, dto);
  }
}
