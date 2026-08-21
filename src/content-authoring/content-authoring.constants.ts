import { registerPermissions } from '../authorization/permission-registry';

/**
 * Content authoring permission codes (Phase 2.2A-1, TD-247). Registered in the application permission registry
 * (TD-26/90) at module load, exactly like the payments recovery constants. RolePermission mapping lives in the DB
 * (seeded idempotently by the system bootstrap). No role-name bypass anywhere.
 *
 * - content.author         → author content INSIDE a Subject, ONLY with an active SubjectAssignment for it.
 * - content.subject.manage → create/manage top-level Subjects and manage SubjectAssignments (global capability).
 */
export const CONTENT_AUTHOR = 'content.author';
export const CONTENT_SUBJECT_MANAGE = 'content.subject.manage';

export const CONTENT_AUTHORING_PERMISSIONS = [CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE] as const;

registerPermissions(CONTENT_AUTHORING_PERMISSIONS);

/** Stable StaffAudit action codes for this slice (application registry, TD-90). */
export const CONTENT_AUDIT = {
  SUBJECT_CREATE: 'content.subject.create',
  SUBJECT_UPDATE: 'content.subject.update',
  ASSIGNMENT_ADD: 'content.subject_assignment.add',
  ASSIGNMENT_REMOVE: 'content.subject_assignment.remove',
  TRACK_CREATE: 'content.track.create',
  TRACK_UPDATE: 'content.track.update',
  LEVEL_CREATE: 'content.level.create',
  LEVEL_UPDATE: 'content.level.update',
  MODULE_CREATE: 'content.module.create',
  MODULE_UPDATE: 'content.module.update',
  TOPIC_CREATE: 'content.topic.create',
  TOPIC_UPDATE: 'content.topic.update',
  LESSON_CREATE: 'content.lesson.create',
  LESSON_UPDATE: 'content.lesson.update',
  LESSON_MOVE: 'content.lesson.move',
} as const;

/** StaffAudit.targetType stable values. */
export const CONTENT_TARGET = {
  SUBJECT: 'Subject',
  SUBJECT_ASSIGNMENT: 'SubjectAssignment',
  TRACK: 'Track',
  LEVEL: 'Level',
  MODULE: 'Module',
  TOPIC: 'Topic',
  LESSON: 'Lesson',
} as const;
