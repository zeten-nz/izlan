import { IsUUID } from 'class-validator';
import { LessonEditDto } from './common.dto';

/** POST /staff/content/lessons/:lessonId/prerequisites — source Lesson requires prerequisiteLessonId (same Subject). */
export class AddPrerequisiteDto extends LessonEditDto {
  @IsUUID(undefined, { message: 'prerequisiteLessonId must be a valid id' })
  prerequisiteLessonId!: string;
}

/** DELETE /staff/content/lessons/:lessonId/prerequisites/:prerequisiteLessonId — carries the Lesson token. */
export class RemovePrerequisiteDto extends LessonEditDto {}
