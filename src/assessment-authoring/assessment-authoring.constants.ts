import { registerPermissions } from '../authorization/permission-registry';

/**
 * Assessment authoring permission codes (V1 — diagnostic/placement authoring). Registered in the application
 * permission registry at module load, exactly like content-authoring. RolePermission mapping lives in the DB (seeded
 * idempotently by the system bootstrap). No role-name bypass anywhere; every operation ALSO requires a SubjectAssignment.
 *
 * - assessment.author  → author a Subject's diagnostic (reads + draft version + items + config), ONLY with a SubjectAssignment.
 * - assessment.publish → submit-review / return-to-draft / publish, ONLY with a SubjectAssignment.
 */
export const ASSESSMENT_AUTHOR = 'assessment.author';
export const ASSESSMENT_PUBLISH = 'assessment.publish';

export const ASSESSMENT_AUTHORING_PERMISSIONS = [ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH] as const;

registerPermissions(ASSESSMENT_AUTHORING_PERMISSIONS);

/** Stable StaffAudit action codes for assessment authoring (application registry). `assessment.<resource>.<action>`. */
export const ASSESSMENT_AUDIT = {
  DEFINITION_CREATE: 'assessment.definition.create',
  DEFINITION_UPDATE: 'assessment.definition.update',
  VERSION_CREATE: 'assessment.version.create',
  VERSION_UPDATE: 'assessment.version.update',
  VERSION_REORDER_ITEMS: 'assessment.version.reorder_items',
  VERSION_SUBMIT_REVIEW: 'assessment.version.submit_review',
  VERSION_RETURN_DRAFT: 'assessment.version.return_draft',
  VERSION_PUBLISH: 'assessment.version.publish',
  ITEM_CREATE: 'assessment.item.create',
  ITEM_UPDATE: 'assessment.item.update',
  ITEM_DELETE: 'assessment.item.delete',
} as const;

/** StaffAudit.targetType stable values. */
export const ASSESSMENT_TARGET = {
  DEFINITION: 'AssessmentDefinition',
  VERSION: 'AssessmentDefinitionVersion',
  ITEM: 'AssessmentItem',
} as const;
