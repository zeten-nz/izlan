import { IsUUID } from 'class-validator';
import { LessonEditDto, RevisionEditDto } from './common.dto';

/** POST /staff/content/lessons/:lessonId/skills — add a same-subject ACTIVE Skill to a DRAFT Lesson. */
export class AddLessonSkillDto extends LessonEditDto {
  @IsUUID(undefined, { message: 'skillId must be a valid id' })
  skillId!: string;
}

/** DELETE /staff/content/lessons/:lessonId/skills/:skillId — carries the Lesson token in the body. */
export class RemoveLessonSkillDto extends LessonEditDto {}

/** POST /staff/content/activities/:activityId/skills — add a same-subject ACTIVE Skill to a DRAFT-revision Activity. */
export class AddActivitySkillDto extends RevisionEditDto {
  @IsUUID(undefined, { message: 'skillId must be a valid id' })
  skillId!: string;
}

/** DELETE /staff/content/activities/:activityId/skills/:skillId — carries the revision token in the body. */
export class RemoveActivitySkillDto extends RevisionEditDto {}
