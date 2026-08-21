import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { SkillMappingService } from '../skill-mapping.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { AddActivitySkillDto, AddLessonSkillDto, RemoveActivitySkillDto, RemoveLessonSkillDto } from '../dto/mapping.dto';

/**
 * Staff LessonSkill + ActivitySkill authoring (Phase 2.2A-3). content.author + SubjectAssignment; same-Subject
 * invariant. LessonSkill mutates a DRAFT logical Lesson (Lesson token); ActivitySkill mutates a DRAFT LessonRevision
 * (Revision token). These write the existing learner authorities (roadmap / review-session).
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class SkillMappingsController {
  constructor(private readonly mappings: SkillMappingService) {}

  // ── LessonSkill ──
  @Get('lessons/:lessonId/skills')
  listLesson(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string) {
    return this.mappings.listLessonSkills(p.userId, lessonId);
  }
  @Post('lessons/:lessonId/skills')
  addLesson(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Body() dto: AddLessonSkillDto) {
    return this.mappings.addLessonSkill(p.userId, lessonId, dto);
  }
  @Delete('lessons/:lessonId/skills/:skillId')
  removeLesson(@CurrentPrincipal() p: AuthPrincipal, @Param('lessonId') lessonId: string, @Param('skillId') skillId: string, @Body() dto: RemoveLessonSkillDto) {
    return this.mappings.removeLessonSkill(p.userId, lessonId, skillId, dto);
  }

  // ── ActivitySkill ──
  @Get('activities/:activityId/skills')
  listActivity(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string) {
    return this.mappings.listActivitySkills(p.userId, activityId);
  }
  @Post('activities/:activityId/skills')
  addActivity(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string, @Body() dto: AddActivitySkillDto) {
    return this.mappings.addActivitySkill(p.userId, activityId, dto);
  }
  @Delete('activities/:activityId/skills/:skillId')
  removeActivity(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string, @Param('skillId') skillId: string, @Body() dto: RemoveActivitySkillDto) {
    return this.mappings.removeActivitySkill(p.userId, activityId, skillId, dto);
  }
}
