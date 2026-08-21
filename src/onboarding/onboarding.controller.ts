import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { OnboardingService } from './onboarding.service';
import { SaveLearningIntentDto } from './dto/save-learning-intent.dto';

/**
 * Onboarding API (§21/23/26/27). Global AuthGuard → authenticated. Own-user (principal).
 * Subject/Track — read-only PUBLISHED discovery. Learning-choice persistence endpoint YO'Q
 * (schema modeli yo'q — §31 architecture gap).
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  status(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.onboarding.getStatus(principal.userId);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.onboarding.complete(principal.userId); // required yo'q → ProfileIncompleteError → 409
  }

  @Get('subjects')
  subjects() {
    return this.onboarding.listSubjects();
  }

  @Get('subjects/:subjectId/tracks')
  tracks(@Param('subjectId', ParseUUIDPipe) subjectId: string) {
    // Malformed UUID → 400 (ParseUUIDPipe); mavjud emas/PUBLISHED emas → 404 (service).
    return this.onboarding.listTracks(subjectId);
  }

  // ── Learning intent (TD-93) — own user, single resumable endpoint (§21) ──
  @Get('learning-intents')
  learningIntents(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.onboarding.listIntents(principal.userId);
  }

  @Put('learning-intent')
  saveLearningIntent(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: SaveLearningIntentDto) {
    // subjectId majburiy; trackId ixtiyoriy (subject-only → resumable). Validatsiya service'da.
    return this.onboarding.saveIntent(principal.userId, dto.subjectId, dto.trackId);
  }
}
