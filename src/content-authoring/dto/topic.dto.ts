import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, OptionalPresent, Trim } from './common.dto';

/** POST /staff/content/modules/:moduleId/topics — DRAFT Topic. */
export class CreateTopicDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsInt() @Min(0)
  sortOrder!: number;
}

export class UpdateTopicDto extends ConcurrentEditDto {
  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string | null;

  @OptionalPresent() @IsInt() @Min(0)
  sortOrder?: number;
}
