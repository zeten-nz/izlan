import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LessonEditDto, NO_CONTROL, Trim } from './common.dto';

/** POST /lessons/:lessonId/archive — urgent takedown, PUBLISHED Lesson → ARCHIVED (content.publish); reason mandatory. */
export class ArchiveLessonDto extends LessonEditDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(1000) @Matches(NO_CONTROL, { message: 'reason contains control characters' })
  reason!: string;
}
