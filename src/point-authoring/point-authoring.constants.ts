/**
 * V2 Roadmap Point authoring — audit action codes + target types. Permission codes are REUSED from the V1
 * content-authoring substrate (content.author / content.publish / content.subject.manage) — a Methodist authors
 * a point only inside an assigned Subject, exactly as for lessons. No new permission naming is introduced.
 */
export const POINT_AUDIT = {
  POINT_CREATE: 'V2_POINT_CREATE',
  POINT_REVISION_CREATE: 'V2_POINT_REVISION_CREATE',
  POINT_REVISION_UPDATE: 'V2_POINT_REVISION_UPDATE',
  POINT_SKILLS_SET: 'V2_POINT_SKILLS_SET',
  POINT_PREREQS_SET: 'V2_POINT_PREREQS_SET',
  BLUEPRINT_STAGES_SET: 'V2_BLUEPRINT_STAGES_SET',
  MASTERY_SET: 'V2_MASTERY_SET',
  SOURCE_CREATE: 'V2_SOURCE_CREATE',
  SOURCE_ATTACH: 'V2_SOURCE_ATTACH',
  ISSUE_RAISE: 'V2_QUALITY_ISSUE_RAISE',
  ISSUE_RESOLVE: 'V2_QUALITY_ISSUE_RESOLVE',
  POINT_SUBMIT_REVIEW: 'V2_POINT_SUBMIT_REVIEW',
  POINT_RETURN_DRAFT: 'V2_POINT_RETURN_DRAFT',
  POINT_REVIEW: 'V2_POINT_REVIEW',
  POINT_PUBLISH: 'V2_POINT_PUBLISH',
  INTEGRITY_DECISION: 'V2_EVIDENCE_INTEGRITY_DECISION',
} as const;

export const POINT_TARGET = {
  ROADMAP_POINT: 'ROADMAP_POINT',
  ROADMAP_POINT_REVISION: 'ROADMAP_POINT_REVISION',
  TEACHING_BLUEPRINT_REVISION: 'TEACHING_BLUEPRINT_REVISION',
  MASTERY_REQUIREMENT_REVISION: 'MASTERY_REQUIREMENT_REVISION',
  SOURCE_REFERENCE: 'SOURCE_REFERENCE',
  CONTENT_QUALITY_ISSUE: 'CONTENT_QUALITY_ISSUE',
  EVIDENCE_INTEGRITY_DECISION: 'EVIDENCE_INTEGRITY_DECISION',
} as const;

/** The active Content Quality policy the pilot publishes under. Seeded idempotently on first publish/read. */
export const CONTENT_QUALITY_POLICY_CODE = 'content-quality-policy-v1';

/** Default policy config — pedagogical hard-blocker gate. A specific point MAY legitimately need zero external
 *  sources (grammar rules); the *capability* still exists. Four-eyes is off for the pilot but policy-driven. */
export const DEFAULT_CONTENT_QUALITY_POLICY_CONFIG = {
  schemaVersion: 'content-quality-policy/v1',
  requireApprovedReview: true, // an APPROVED ContentReview is required before publish
  requireFourEyes: false, // author may also be the reviewer for the pilot (policy-tunable)
  requireSourceForPoint: false, // A1 grammar points legitimately need zero external references (capability still exists)
  masteryEvidenceKinds: ['recognition', 'controlled-production'], // HONEST kinds objective activities can satisfy (never free-production — integrity wave 3)
} as const;

/** Evidence kinds a blueprint's EVIDENCE-role bindings can honestly produce (integrity wave 3): recognition (choice),
 *  controlled-production (structured), plus the receptive comprehension kinds. NEVER free-production. */
export const OBJECTIVE_EVIDENCE_KINDS = ['recognition', 'controlled-production', 'listening-comprehension', 'reading-comprehension'] as const;
export const OBJECTIVE_EVIDENCE_INDEPENDENCE = 2;
