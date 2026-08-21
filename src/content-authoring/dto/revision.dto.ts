import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, OptionalPresent, Trim } from './common.dto';

/**
 * POST /staff/content/lessons/:lessonId/revisions — creates a DRAFT LessonRevision. `version`/`status`/`createdBy`/
 * `updatedBy`/reviewer/publisher/`estimatedDurationMin` are all server-owned; a body containing them is rejected 400
 * (whitelist + forbidNonWhitelisted). `title` is required; `description` is optional (nullable on update).
 */
export class CreateRevisionDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;
}

/** PATCH /staff/content/revisions/:revisionId — DRAFT only; title required-if-present, description clearable. */
export class UpdateRevisionDto extends ConcurrentEditDto {
  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string | null;
}
