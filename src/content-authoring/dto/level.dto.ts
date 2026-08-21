import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, Trim } from './common.dto';

/** POST /staff/content/tracks/:trackId/levels — DRAFT Level. `code` is a free display code (TD-27), not an enum. */
export class CreateLevelDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(50) @Matches(NO_CONTROL, { message: 'code contains control characters' })
  code!: string;

  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsInt() @Min(0)
  sortOrder!: number;
}

export class UpdateLevelDto extends ConcurrentEditDto {
  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(50) @Matches(NO_CONTROL, { message: 'code contains control characters' })
  code?: string;

  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
