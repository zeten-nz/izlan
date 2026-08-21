import { IsISO8601, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, Trim } from './common.dto';

/** POST /revisions/:revisionId/submit-review — DRAFT → REVIEW (content.author). */
export class SubmitReviewDto extends ConcurrentEditDto {}

/** POST /revisions/:revisionId/return-to-draft — REVIEW → DRAFT (content.publish); reason mandatory (audited). */
export class ReturnToDraftDto extends ConcurrentEditDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(1000) @Matches(NO_CONTROL, { message: 'reason contains control characters' })
  reason!: string;
}

/**
 * POST /revisions/:revisionId/publish — REVIEW → PUBLISHED (content.publish). Carries BOTH aggregate tokens: the
 * revision's and the Lesson's current `updatedAt` (an actual publication switches both). Idempotent republish of the
 * already-current revision succeeds even with stale tokens.
 */
export class PublishRevisionDto {
  @IsISO8601({ strict: true }, { message: 'expectedRevisionUpdatedAt must be an ISO-8601 timestamp' })
  expectedRevisionUpdatedAt!: string;

  @IsISO8601({ strict: true }, { message: 'expectedLessonUpdatedAt must be an ISO-8601 timestamp' })
  expectedLessonUpdatedAt!: string;
}
