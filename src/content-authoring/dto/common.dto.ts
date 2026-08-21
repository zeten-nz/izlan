import { IsISO8601, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

/** Trim string inputs before validation (mirrors the profile DTO convention). */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * PATCH "optional by presence, but NOT nullable" (§3 review correction). Unlike class-validator's `@IsOptional()`
 * (which skips validation for BOTH undefined and null), this validates whenever the key is present — so an explicit
 * `null` for a NON-NULL field flows into the field validators (@IsString/@IsInt) and is rejected 400, instead of
 * being pushed down into Prisma/PostgreSQL. A missing key (undefined) still means "do not change".
 */
export const OptionalPresent = () => ValidateIf((_o: object, v: unknown) => v !== undefined);

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

/**
 * Revision-aggregate concurrency token (Phase 2.2A-2, §12): every Activity mutation (create/patch/delete/reorder)
 * carries the owning DRAFT LessonRevision's exact `updatedAt`. The revision is the authoring concurrency boundary.
 */
export class RevisionEditDto {
  @IsISO8601({ strict: true }, { message: 'expectedRevisionUpdatedAt must be an ISO-8601 timestamp' })
  expectedRevisionUpdatedAt!: string;
}

/**
 * Lesson-aggregate concurrency token (Phase 2.2A-3, §15): LessonSkill + prerequisite graph mutations carry the source
 * Lesson's exact `updatedAt`. The Lesson is the aggregate concurrency boundary for those relations.
 */
export class LessonEditDto {
  @IsISO8601({ strict: true }, { message: 'expectedLessonUpdatedAt must be an ISO-8601 timestamp' })
  expectedLessonUpdatedAt!: string;
}
