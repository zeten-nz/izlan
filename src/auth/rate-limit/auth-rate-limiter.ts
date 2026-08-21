import { Injectable } from '@nestjs/common';

/**
 * Per-IP rate limit FOUNDATION (§23, TD-19). Redis YO'Q — MVP in-memory sliding window.
 * HTTP/IP binding (real client IP) → Phase 1.4C. DB-backed per-phone OTP limit — OtpService'da (hozir).
 * Distributed limiting kelajakda Redis bilan (bu abstraksiya ortida almashtiriladi).
 */
export interface AuthRateLimiter {
  /** true = allowed (limit ichida); false = bloklangan. */
  tryConsume(key: string, limit: number, windowMs: number): boolean;
}

@Injectable()
export class InMemoryAuthRateLimiter implements AuthRateLimiter {
  private readonly hits = new Map<string, number[]>();

  tryConsume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
