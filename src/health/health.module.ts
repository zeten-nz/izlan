import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * HealthModule — liveness/readiness. PrismaService global DatabaseModule'dan keladi.
 * Terminus ishlatilmadi (§19): ikkita sodda endpoint uchun keraksiz abstraksiya;
 * minimal custom HealthService yetarli va aniqroq.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
