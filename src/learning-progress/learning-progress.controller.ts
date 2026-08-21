import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { LearningProgressService } from './learning-progress.service';

/**
 * Learning Progress repair API (Phase 1.8A §35). Own-user only (global AuthGuard). Rebuilds current
 * LearnerSkillState from existing SkillMeasurement history — it NEVER creates measurements. Idempotent.
 */
@Controller('learning-progress')
export class LearningProgressController {
  constructor(private readonly service: LearningProgressService) {}

  /** Recompute all affected current states for principal + Subject (recovery / rebuild / deterministic replay). */
  @Post('me/subjects/:subjectId/recompute')
  @HttpCode(200)
  recompute(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.service.recomputeSubject(principal.userId, subjectId);
  }
}
