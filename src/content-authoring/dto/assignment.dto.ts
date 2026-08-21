import { IsUUID } from 'class-validator';

/** POST /staff/content/subjects/:subjectId/assignments — assign a user to a Subject (content.subject.manage). */
export class AssignUserDto {
  @IsUUID(undefined, { message: 'userId must be a valid id' })
  userId!: string;
}
