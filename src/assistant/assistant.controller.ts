import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { AssistantService } from './assistant.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

/**
 * V2 Student Assistant API. Global AuthGuard → authenticated; own-session only (getSession is 404-safe on another
 * learner's session). Always 200: an ANSWERED / DECLINED / UNAVAILABLE result is a normal outcome — a missing or
 * failed AI provider degrades gracefully and never becomes a 5xx that would break the learning UI.
 */
@Controller('v2/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Ask the context-aware tutor for help within the learner's own teaching session. Advisory — mutates nothing. */
  @Post('teaching-sessions/:sessionId/ask')
  @HttpCode(200)
  ask(@CurrentPrincipal() principal: AuthPrincipal, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: AskAssistantDto) {
    return this.assistant.askForTeachingSession(principal.userId, sessionId, dto.task, dto.question ?? null, dto.language ?? 'uz');
  }
}
