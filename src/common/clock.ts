import { Injectable } from '@nestjs/common';

/**
 * Injectable wall-clock boundary (Phase 1.7A §7). Domain logic derives "now" from here instead of
 * scattering `new Date()`, so local-date / midnight / timezone / concurrency behavior is testable with
 * a fixed clock (override the provider in tests). No external dependency.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
