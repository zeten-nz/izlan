import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { XpModule } from '../xp/xp.module';
import { FinanceModule } from '../finance/finance.module';
import { DailyMissionController } from './daily-mission.controller';
import { DailyMissionService } from './daily-mission.service';
import { DailyMissionRepository } from './daily-mission.repository';

/**
 * Daily Mission Foundation (Phase 2.0B). Reads ActivityAttempt evidence + profile timezone via its own
 * repository and reuses the DailyPlan local-date utility (file import). Other domains (LessonExecution,
 * ReviewSession) import it to evaluate an attempt after persistence — one-way, no cycle. Phase 2.0C-2/2.0D imports
 * XpModule (XP bridge); Phase 2.1A imports FinanceModule (independent IZL bridge). One-way: DailyMission →
 * Xp/Finance. It never Prisma-writes XpGrant / RewardGrant / IZLLedgerEntry.
 */
@Module({
  imports: [ClockModule, XpModule, FinanceModule],
  controllers: [DailyMissionController],
  providers: [DailyMissionService, DailyMissionRepository],
  exports: [DailyMissionService],
})
export class DailyMissionModule {}
