import { Module } from '@nestjs/common';
import { XpController } from './xp.controller';
import { XpService } from './xp.service';
import { XpRepository } from './xp.repository';

/**
 * XP module (Phase 2.0C-2). The single XpGrant writer (§20). Reads DailyMissionCompletion via its own repository
 * (no import of DailyMissionModule — one-way: DailyMissionModule → XpModule). Writes only append-only XpGrant.
 */
@Module({
  controllers: [XpController],
  providers: [XpService, XpRepository],
  exports: [XpService],
})
export class XpModule {}
