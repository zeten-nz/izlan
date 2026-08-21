import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { PrerequisiteService } from '../prerequisite.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { AddPrerequisiteDto, RemovePrerequisiteDto } from '../dto/prerequisite.dto';

/**
 * Staff LessonPrerequisite authoring (Phase 2.2A-3). content.author + SubjectAssignment; same-Subject edges; DRAFT
 * source Lesson only; transactional full-DAG cycle prevention (Subject-row lock). Lesson.updatedAt aggregate token.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class PrerequisitesController {
  constructor(private readonly prerequisites: PrerequisiteService) {}

  @Get('lessons/:lessonId/prerequisites')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string) {
    return this.prerequisites.listPrerequisites(p.userId, lessonId);
  }

  @Post('lessons/:lessonId/prerequisites')
  add(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Body() dto: AddPrerequisiteDto) {
    return this.prerequisites.addPrerequisite(p.userId, lessonId, dto);
  }

  @Delete('lessons/:lessonId/prerequisites/:prerequisiteLessonId')
  remove(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Param('prerequisiteLessonId') prerequisiteLessonId: string, @Body() dto: RemovePrerequisiteDto) {
    return this.prerequisites.removePrerequisite(p.userId, lessonId, prerequisiteLessonId, dto);
  }
}
