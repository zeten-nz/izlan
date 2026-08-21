import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { LessonExecutionService } from './lesson-execution.service';
import { LessonCompletionService } from './completion/lesson-completion.service';
import { SubmitActivityAttemptDto } from './dto/submit-activity-attempt.dto';

/**
 * Lesson Execution API (Phase 1.7B §39/40). Global AuthGuard → authenticated; own-user only (§47).
 * No arbitrary lesson start (§3). Activity submission (Phase 1.7B-2) requires a client-owned durable
 * clientRequestId; the server derives all scoring/attemptNo authority.
 */
@Controller('lesson-executions')
export class LessonExecutionController {
  constructor(
    private readonly execution: LessonExecutionService,
    private readonly completion: LessonCompletionService,
  ) {}

  /** Start (or resume) a Lesson referenced by TODAY'S CURRENT DailyPlanItem. */
  @Post('daily-plan-items/:dailyPlanItemId/start')
  @HttpCode(200)
  start(@CurrentPrincipal() principal: AuthPrincipal, @Param('dailyPlanItemId', ParseUUIDPipe) dailyPlanItemId: string) {
    return this.execution.startFromDailyPlanItem(principal.userId, dailyPlanItemId);
  }

  /** Resume an own execution by logical Lesson id — returns the pinned revision. */
  @Get(':lessonId')
  resume(@CurrentPrincipal() principal: AuthPrincipal, @Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.execution.resume(principal.userId, lessonId);
  }

  /** Submit an objective activity answer under the pinned execution; server scores + records evidence. */
  @Post(':lessonId/activities/:activityId/attempts')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: SubmitActivityAttemptDto,
  ) {
    return this.execution.submitActivityAttempt(principal.userId, lessonId, activityId, dto.clientRequestId, dto.answer);
  }

  /** Mark a view-only activity step performed (TEXT/EXPLANATION/IMAGE/AUDIO/EXAMPLE). No body, no attempt. */
  @Post(':lessonId/activities/:activityId/complete')
  @HttpCode(200)
  markStep(@CurrentPrincipal() principal: AuthPrincipal, @Param('lessonId', ParseUUIDPipe) lessonId: string, @Param('activityId', ParseUUIDPipe) activityId: string) {
    return this.completion.markViewOnlyStep(principal.userId, lessonId, activityId);
  }

  /** Complete the Lesson (idempotent): validates all steps, derives mastery, reconciles the roadmap. */
  @Post(':lessonId/complete')
  @HttpCode(200)
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Param('lessonId', ParseUUIDPipe) lessonId: string) {
    return this.completion.completeLesson(principal.userId, lessonId);
  }
}
