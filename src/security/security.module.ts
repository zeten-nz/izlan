import { Module } from '@nestjs/common';
import { SecurityEventsRepository } from './security-events.repository';
import { SecurityEventsService } from './security-events.service';
import { InMemoryAuthRateLimiter } from '../auth/rate-limit/auth-rate-limiter';

/**
 * SecurityModule — SecurityEvent (append-only) + per-IP rate limiter foundation.
 * Rate limiter hozir binding'siz (§23) — HTTP/IP integration 1.4C.
 */
@Module({
  providers: [SecurityEventsRepository, SecurityEventsService, InMemoryAuthRateLimiter],
  exports: [SecurityEventsService, InMemoryAuthRateLimiter],
})
export class SecurityModule {}
