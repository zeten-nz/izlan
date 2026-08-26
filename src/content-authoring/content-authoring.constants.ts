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
export const CONTENT_PUBLISH = 'content.publish';

export const CONTENT_AUTHORING_PERMISSIONS = [CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE, CONTENT_PUBLISH] as const;

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
  // Phase 2.2A-2 — draft revision + activity authoring
  REVISION_CREATE: 'content.revision.create',
  REVISION_UPDATE: 'content.revision.update',
  ACTIVITY_CREATE: 'content.activity.create',
  ACTIVITY_UPDATE: 'content.activity.update',
  ACTIVITY_DELETE: 'content.activity.delete',
  ACTIVITY_REORDER: 'content.activity.reorder',
  // Phase 2.2A-3 — skill mapping + prerequisite DAG
  SKILL_CREATE: 'content.skill.create',
  SKILL_UPDATE: 'content.skill.update',
  LESSON_SKILL_ADD: 'content.lesson_skill.add',
  LESSON_SKILL_REMOVE: 'content.lesson_skill.remove',
  ACTIVITY_SKILL_ADD: 'content.activity_skill.add',
  ACTIVITY_SKILL_REMOVE: 'content.activity_skill.remove',
  // Media foundation — activity media attach/detach (DRAFT revision only)
  ACTIVITY_MEDIA_ATTACH: 'content.activity_media.attach',
  ACTIVITY_MEDIA_DETACH: 'content.activity_media.detach',
  PREREQUISITE_ADD: 'content.prerequisite.add',
  PREREQUISITE_REMOVE: 'content.prerequisite.remove',
  // Phase 2.2B — review + publication
  SUBJECT_PUBLISH: 'content.subject.publish',
  TRACK_PUBLISH: 'content.track.publish',
  LEVEL_PUBLISH: 'content.level.publish',
  MODULE_PUBLISH: 'content.module.publish',
  TOPIC_PUBLISH: 'content.topic.publish',
  REVISION_SUBMIT_REVIEW: 'content.revision.submit_review',
  REVISION_RETURN_DRAFT: 'content.revision.return_draft',
  REVISION_PUBLISH: 'content.revision.publish',
  LESSON_ARCHIVE: 'content.lesson.archive',
  // Phase 2.2D — topic-scoped bulk content import (one aggregate event per applied batch)
  IMPORT_APPLY: 'content.import.apply',
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
  LESSON_REVISION: 'LessonRevision',
  ACTIVITY: 'Activity',
  SKILL: 'Skill',
} as const;
