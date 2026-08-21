import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, CONTENT_KEY_RE, SLUG_RE, Trim } from './common.dto';

/**
 * POST /staff/content/topics/:topicId/lessons — DRAFT logical Lesson.
 * `contentKey` is the immutable business/import identity (§10/11): client-supplied, non-empty, bounded, NOT
 * generated and NOT inferred from title/slug. `title` is NOT here — it belongs to LessonRevision (§12).
 */
export class CreateLessonDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(CONTENT_KEY_RE, { message: 'contentKey has an invalid format' })
  contentKey!: string;

  @IsInt() @Min(0)
  sortOrder!: number;

  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;
}

/**
 * PATCH /staff/content/lessons/:id — mutable metadata ONLY (slug, sortOrder). `contentKey` is intentionally
 * absent: because the global ValidationPipe uses whitelist + forbidNonWhitelisted, a body containing `contentKey`
 * (or title/status/publishedRevisionId/createdBy) is REJECTED, not silently ignored (§11/12).
 */
export class UpdateLessonDto extends ConcurrentEditDto {
  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

/** POST /staff/content/lessons/:id/move — DRAFT lesson → another Topic in the SAME Subject (§14). */
export class MoveLessonDto extends ConcurrentEditDto {
  @IsUUID(undefined, { message: 'toTopicId must be a valid id' })
  toTopicId!: string;
}
