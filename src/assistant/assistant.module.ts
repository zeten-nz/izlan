import { Module } from '@nestjs/common';
import { LearningCoreModule } from '../learning-core/learning-core.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ASSISTANT_PORT, AssistantPort } from './assistant.port';
import { UnavailableAssistantAdapter } from './adapters/unavailable-assistant.adapter';
import { StubAssistantAdapter } from './adapters/stub-assistant.adapter';

/**
 * AssistantModule — binds ASSISTANT_PORT (SmsModule bilan bir xil pattern). Default = production-safe
 * UnavailableAssistantAdapter (no production-safe AI provider exists). ASSISTANT_DRIVER=stub selects the
 * DEV/TEST deterministic double — FORBIDDEN in production: the factory throws at startup so a production process
 * can never serve stubbed tutor text as if it were real. Tests can also override ASSISTANT_PORT directly.
 *
 * Imports LearningCoreModule to reuse the learner-safe teaching-session view; no scoring/mastery/roadmap logic
 * is re-derived, and this module performs no writes.
 */
function selectAssistantAdapter(): AssistantPort {
  const driver = (process.env.ASSISTANT_DRIVER ?? '').trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  if (driver === 'stub') {
    if (nodeEnv === 'production') throw new Error('ASSISTANT_DRIVER=stub is forbidden in production');
    return new StubAssistantAdapter();
  }
  return new UnavailableAssistantAdapter();
}

@Module({
  imports: [LearningCoreModule],
  controllers: [AssistantController],
  providers: [AssistantService, { provide: ASSISTANT_PORT, useFactory: selectAssistantAdapter }],
  exports: [AssistantService],
})
export class AssistantModule {}
