import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { ActivityService } from '../activity.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { CreateActivityDto, DeleteActivityDto, ReorderActivitiesDto, UpdateActivityDto } from '../dto/activity.dto';

/**
 * Staff DRAFT-revision Activity authoring (Phase 2.2A-2). content.author + SubjectAssignment (via the revision's
 * Lesson chain). The owning DRAFT LessonRevision is the concurrency aggregate: every mutation carries
 * `expectedRevisionUpdatedAt` and returns the new revision `updatedAt`. Type/position are not PATCH fields.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class ActivitiesController {
  constructor(private readonly activities: ActivityService) {}

  @Get('revisions/:revisionId/activities')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string) {
    return this.activities.listActivities(p.userId, revisionId);
  }

  @Post('revisions/:revisionId/activities')
  create(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: CreateActivityDto) {
    return this.activities.createActivity(p.userId, revisionId, dto);
  }

  @Put('revisions/:revisionId/activities/order')
  reorder(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId') revisionId: string, @Body() dto: ReorderActivitiesDto) {
    return this.activities.reorder(p.userId, revisionId, dto);
  }

  @Get('activities/:activityId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string) {
    return this.activities.getActivity(p.userId, activityId);
  }

  @Patch('activities/:activityId')
  update(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string, @Body() dto: UpdateActivityDto) {
    return this.activities.updateActivity(p.userId, activityId, dto);
  }

  @Delete('activities/:activityId')
  remove(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId') activityId: string, @Body() dto: DeleteActivityDto) {
    return this.activities.deleteActivity(p.userId, activityId, dto);
  }
}
