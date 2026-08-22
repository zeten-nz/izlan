import { createHash } from 'node:crypto';
import { ActivityType } from '@prisma/client';
import { getActivityDefinition } from '../content/activity/activity-registry';

/** Canonical import document version (TD-253). Exact match required. */
export const IMPORT_SCHEMA_VERSION = 'izlan-topic-content/v1';

/** MVP bounds (§34). Enforced before any deep validation. */
export const IMPORT_LIMITS = {
  maxSkills: 200,
  maxLessons: 250,
  maxActivitiesTotal: 5000,
  maxSkillRefsPerLesson: 100,
  maxSkillRefsPerActivity: 50,
  maxPrerequisitesPerLesson: 50,
} as const;

/** Stable IMPORT_* codes + their HTTP status (used by the exception filter via ContentImportError). */
export const IMPORT_STATUS: Record<string, number> = {
  IMPORT_SCHEMA_UNSUPPORTED: 400,
  IMPORT_INVALID_DOCUMENT: 400,
  IMPORT_LIMIT_EXCEEDED: 400,
  IMPORT_CONTENT_KEY_DUPLICATE: 400,
  IMPORT_CONTENT_KEY_EXISTS: 409,
  IMPORT_SKILL_DUPLICATE: 400,
  IMPORT_SKILL_NOT_FOUND: 400,
  IMPORT_SKILL_ARCHIVED: 409,
  IMPORT_SKILL_CONFLICT: 409,
  IMPORT_ACTIVITY_TYPE_UNSUPPORTED: 400,
  IMPORT_ACTIVITY_PAYLOAD_INVALID: 400,
  IMPORT_PREREQUISITE_NOT_FOUND: 400,
  IMPORT_PREREQUISITE_ARCHIVED: 409,
  IMPORT_PREREQUISITE_SUBJECT_MISMATCH: 409,
  IMPORT_PREREQUISITE_CYCLE: 409,
  IMPORT_CONFLICT: 409,
};

/** Import-supported Activity types = text (markdown) + objective ONLY — derived from the registry (no divergent list). */
export const IMPORT_SUPPORTED_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set(
  Object.values(ActivityType).filter((t) => {
    const c = getActivityDefinition(t).payloadContract;
    return c === 'LESSON_MARKDOWN_V1' || c === 'LESSON_OBJECTIVE_V1';
  }),
);

/** A single dry-run validation issue — SAFE metadata only (never payload / markdown / answerKey). */
export interface ImportIssue {
  code: string;
  path: string;
  contentKey?: string;
}

export interface ImportSummary {
  skillsToCreate: number;
  skillsReused: number;
  lessonsToCreate: number;
  revisionsToCreate: number;
  activitiesToCreate: number;
  lessonSkillMappings: number;
  activitySkillMappings: number;
  prerequisitesToCreate: number;
}

/** Normalized (parsed + payload-validated) plan produced by the pure parser — the shared input to validate + apply. */
export interface PlanActivity {
  type: ActivityType;
  position: number; // derived from array index (0..N-1)
  payload: Record<string, unknown>; // canonical validated payload (may contain answerKey — server-only)
  estimatedDurationMin: number | null;
  skillCodes: string[];
}
export interface PlanLesson {
  contentKey: string;
  slug: string | null;
  sortOrder: number;
  skillCodes: string[];
  prerequisiteContentKeys: string[];
  revision: { title: string; description: string | null; activities: PlanActivity[] };
}
export interface PlanSkill {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
}
export interface ImportPlan {
  skills: PlanSkill[];
  lessons: PlanLesson[];
}

/** Deterministic, key-sorted serialization → SHA-256. Stable regardless of input key order (arrays keep order). */
export function documentHash(plan: ImportPlan): string {
  return createHash('sha256').update(canonicalize(plan)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}
