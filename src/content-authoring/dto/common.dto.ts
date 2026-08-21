import { IsISO8601 } from 'class-validator';
import { Transform } from 'class-transformer';

/** Trim string inputs before validation (mirrors the profile DTO convention). */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Reject control characters (allow all other Unicode). */
export const NO_CONTROL = /^[^\p{Cc}]+$/u;
/** Lowercase kebab-case slug. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Bounded import/business key charset — NOT derived from title/slug (§10/11). */
export const CONTENT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Optimistic-concurrency token required on every mutating PATCH/move (§16): the exact `updatedAt` last read. */
export class ConcurrentEditDto {
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt must be an ISO-8601 timestamp' })
  expectedUpdatedAt!: string;
}
