import { ArrayMaxSize, ArrayMinSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, OptionalPresent, SLUG_RE, Trim } from './common.dto';

/**
 * POST /staff/content/subjects — creates a DRAFT Subject (status/createdBy never from the client, §10). Ordering is
 * assigned automatically by the server (canonical sortOrder), so staff never send a position — `sortOrder` is not an
 * input field. The `slug` is a lowercase kebab-case identifier (the client auto-derives it from the title, but the
 * server remains authoritative).
 */
export class CreateSubjectDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug!: string;

  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;
}

/**
 * PATCH /staff/content/subjects/:id — mutable metadata only; no status/createdBy (§12) and no sortOrder (ordering is
 * server-owned; use the reorder endpoint). Non-null fields use `@OptionalPresent()` so an explicit `null` is rejected
 * 400; `description` is intentionally nullable (clearable).
 */
export class UpdateSubjectDto extends ConcurrentEditDto {
  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string | null;
}

/** PUT /staff/content/subjects/order — canonical reorder. The exact set of the actor's manageable subjects, in order. */
export class ReorderSubjectsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMinSize(1) @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  orderedSubjectIds!: string[];
}
