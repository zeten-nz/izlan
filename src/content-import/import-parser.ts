import { ActivityType } from '@prisma/client';
import { ContentActivityPayloadInvalidError, ContentActivityTypeNotAuthorableError, ContentImportError } from '../common/errors';
import { validateActivityPayloadForAuthoring } from '../content/activity/authoring-payload';
import { CONTENT_KEY_RE, NO_CONTROL, SLUG_RE } from '../content-authoring/dto/common.dto';
import { IMPORT_LIMITS, IMPORT_SCHEMA_VERSION, IMPORT_STATUS, IMPORT_SUPPORTED_ACTIVITY_TYPES, type ImportIssue, type ImportPlan, type PlanActivity, type PlanLesson, type PlanSkill } from './import-contract';

const MAX_DURATION_MIN = 100_000;
const ACTIVITY_TYPES = new Set<string>(Object.values(ActivityType));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isIntGte0 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function hard(code: string): never {
  throw new ContentImportError(code, IMPORT_STATUS[code] ?? 400);
}
const invalid = (issues: ImportIssue[], path: string) => issues.push({ code: 'IMPORT_INVALID_DOCUMENT', path });

/** Reject typo/unknown keys on an object (§9) — a `"skillCodez"` fails instead of being ignored. */
function checkExactKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, issues: ImportIssue[]): void {
  const set = new Set(allowed);
  for (const k of Object.keys(obj)) if (!set.has(k)) invalid(issues, path ? `${path}.${k}` : k);
}

/**
 * STRICT structural + canonical-payload validation (pure, no DB, §68). Throws ContentImportError ONLY for hard/
 * unprocessable input (wrong schemaVersion, non-object root, count limits). All field-level problems are COLLECTED as
 * issues so the dry-run can report them together. Builds the normalized ImportPlan (payloads validated + normalized).
 */
export function parseImportDocument(body: unknown): { plan: ImportPlan; issues: ImportIssue[] } {
  if (!isObj(body)) hard('IMPORT_INVALID_DOCUMENT');
  if (body.schemaVersion !== IMPORT_SCHEMA_VERSION) hard('IMPORT_SCHEMA_UNSUPPORTED');

  const issues: ImportIssue[] = [];
  checkExactKeys(body, ['schemaVersion', 'skills', 'lessons'], '', issues);

  const skillsRaw = body.skills;
  const lessonsRaw = body.lessons;
  if (skillsRaw !== undefined && !Array.isArray(skillsRaw)) invalid(issues, 'skills');
  if (!Array.isArray(lessonsRaw)) invalid(issues, 'lessons');
  const skillsArr = Array.isArray(skillsRaw) ? skillsRaw : [];
  const lessonsArr = Array.isArray(lessonsRaw) ? lessonsRaw : [];

  if (skillsArr.length > IMPORT_LIMITS.maxSkills || lessonsArr.length > IMPORT_LIMITS.maxLessons) hard('IMPORT_LIMIT_EXCEEDED');

  const plan: ImportPlan = { skills: [], lessons: [] };

  // Package-local Skill identity: reject duplicate declared CODES and duplicate declared NAMES (the DB enforces both
  // `@@unique([subjectId, code])` and `@@unique([subjectId, name])`, so dry-run must catch these deterministically —
  // not let apply fail on a constraint). Normalization = trim, matching the DB key and the DB-resolution comparison.
  const seenSkillCodes = new Set<string>();
  const seenSkillNames = new Set<string>();
  skillsArr.forEach((s, i) => {
    const skill = validateSkill(s, `skills[${i}]`, issues);
    if (skill) {
      if (seenSkillCodes.has(skill.code)) issues.push({ code: 'IMPORT_SKILL_DUPLICATE', path: `skills[${i}]` });
      else seenSkillCodes.add(skill.code);
      if (seenSkillNames.has(skill.name)) issues.push({ code: 'IMPORT_SKILL_DUPLICATE', path: `skills[${i}]` });
      else seenSkillNames.add(skill.name);
      plan.skills.push(skill);
    }
  });

  let totalActivities = 0;
  const seenContentKeys = new Set<string>();
  lessonsArr.forEach((l, i) => {
    const lesson = validateLesson(l, `lessons[${i}]`, issues);
    if (lesson) {
      if (seenContentKeys.has(lesson.contentKey)) issues.push({ code: 'IMPORT_CONTENT_KEY_DUPLICATE', path: `lessons[${i}]`, contentKey: lesson.contentKey });
      else seenContentKeys.add(lesson.contentKey);
      totalActivities += lesson.revision.activities.length;
      plan.lessons.push(lesson);
    }
  });
  if (totalActivities > IMPORT_LIMITS.maxActivitiesTotal) hard('IMPORT_LIMIT_EXCEEDED');

  // Aggregate relationship caps (TD-253 safety bounds). The per-item limits can multiply into pathological totals
  // (e.g. 5000 activities × 50 skill refs). Count UNIQUE references (lists are already de-duplicated above) and reject
  // BEFORE any write transaction — apply parses first, so validate + apply agree.
  let lessonSkillTotal = 0;
  let activitySkillTotal = 0;
  let prerequisiteTotal = 0;
  for (const l of plan.lessons) {
    lessonSkillTotal += l.skillCodes.length;
    prerequisiteTotal += l.prerequisiteContentKeys.length;
    for (const a of l.revision.activities) activitySkillTotal += a.skillCodes.length;
  }
  if (
    lessonSkillTotal > IMPORT_LIMITS.maxLessonSkillMappingsTotal ||
    activitySkillTotal > IMPORT_LIMITS.maxActivitySkillMappingsTotal ||
    prerequisiteTotal > IMPORT_LIMITS.maxPrerequisitesTotal
  ) {
    hard('IMPORT_LIMIT_EXCEEDED');
  }

  return { plan, issues };
}

function validateSkill(raw: unknown, path: string, issues: ImportIssue[]): PlanSkill | null {
  if (!isObj(raw)) return void invalid(issues, path), null;
  checkExactKeys(raw, ['code', 'name', 'description', 'sortOrder'], path, issues);
  const code = isStr(raw.code) ? raw.code.trim() : '';
  const name = isStr(raw.name) ? raw.name.trim() : '';
  if (!code || code.length > 80 || !NO_CONTROL.test(code)) invalid(issues, `${path}.code`);
  if (!name || name.length > 200 || !NO_CONTROL.test(name)) invalid(issues, `${path}.name`);
  const description = normDescription(raw.description, `${path}.description`, issues);
  const sortOrder = normSortOrder(raw.sortOrder, `${path}.sortOrder`, issues);
  if (!code || !name) return null;
  return { code, name, description, sortOrder };
}

function validateLesson(raw: unknown, path: string, issues: ImportIssue[]): PlanLesson | null {
  if (!isObj(raw)) return void invalid(issues, path), null;
  checkExactKeys(raw, ['contentKey', 'slug', 'sortOrder', 'skillCodes', 'prerequisiteContentKeys', 'revision'], path, issues);
  const contentKey = isStr(raw.contentKey) ? raw.contentKey.trim() : '';
  if (!contentKey || contentKey.length > 200 || !CONTENT_KEY_RE.test(contentKey)) invalid(issues, `${path}.contentKey`);
  let slug: string | null = null;
  if (raw.slug !== undefined && raw.slug !== null) {
    if (isStr(raw.slug) && SLUG_RE.test(raw.slug.trim()) && raw.slug.trim().length <= 200) slug = raw.slug.trim();
    else invalid(issues, `${path}.slug`);
  }
  const sortOrder = normSortOrder(raw.sortOrder, `${path}.sortOrder`, issues, true);
  const skillCodes = normSkillCodeList(raw.skillCodes, `${path}.skillCodes`, IMPORT_LIMITS.maxSkillRefsPerLesson, issues);
  const prerequisiteContentKeys = normContentKeyList(raw.prerequisiteContentKeys, `${path}.prerequisiteContentKeys`, IMPORT_LIMITS.maxPrerequisitesPerLesson, issues);
  const revision = validateRevision(raw.revision, `${path}.revision`, issues);
  if (!contentKey || !revision) return null;
  return { contentKey, slug, sortOrder, skillCodes, prerequisiteContentKeys, revision };
}

function validateRevision(raw: unknown, path: string, issues: ImportIssue[]): PlanLesson['revision'] | null {
  if (!isObj(raw)) return void invalid(issues, path), null;
  checkExactKeys(raw, ['title', 'description', 'activities'], path, issues);
  const title = isStr(raw.title) ? raw.title.trim() : '';
  if (!title || title.length > 300 || !NO_CONTROL.test(title)) invalid(issues, `${path}.title`);
  const description = normDescription(raw.description, `${path}.description`, issues);
  if (!Array.isArray(raw.activities)) {
    invalid(issues, `${path}.activities`);
    return title ? { title, description, activities: [] } : null;
  }
  const activities: PlanActivity[] = [];
  raw.activities.forEach((a, i) => {
    const act = validateActivity(a, i, `${path}.activities[${i}]`, issues);
    if (act) activities.push(act);
  });
  if (!title) return null;
  return { title, description, activities };
}

function validateActivity(raw: unknown, index: number, path: string, issues: ImportIssue[]): PlanActivity | null {
  if (!isObj(raw)) return void invalid(issues, path), null;
  checkExactKeys(raw, ['type', 'estimatedDurationMin', 'payload', 'skillCodes'], path, issues);
  const typeStr = isStr(raw.type) ? raw.type : '';
  if (!ACTIVITY_TYPES.has(typeStr) || !IMPORT_SUPPORTED_ACTIVITY_TYPES.has(typeStr as ActivityType)) {
    issues.push({ code: 'IMPORT_ACTIVITY_TYPE_UNSUPPORTED', path: `${path}.type` });
    return null;
  }
  const type = typeStr as ActivityType;
  let estimatedDurationMin: number | null = null;
  if (raw.estimatedDurationMin !== undefined && raw.estimatedDurationMin !== null) {
    if (isIntGte0(raw.estimatedDurationMin) && raw.estimatedDurationMin <= MAX_DURATION_MIN) estimatedDurationMin = raw.estimatedDurationMin;
    else invalid(issues, `${path}.estimatedDurationMin`);
  }
  const skillCodes = normSkillCodeList(raw.skillCodes, `${path}.skillCodes`, IMPORT_LIMITS.maxSkillRefsPerActivity, issues);

  if (!('payload' in raw) || !isObj(raw.payload)) {
    invalid(issues, `${path}.payload`);
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = validateActivityPayloadForAuthoring(type, raw.payload); // canonical authoring validator (no payload echo)
  } catch (e) {
    if (e instanceof ContentActivityTypeNotAuthorableError) issues.push({ code: 'IMPORT_ACTIVITY_TYPE_UNSUPPORTED', path: `${path}.type` });
    else if (e instanceof ContentActivityPayloadInvalidError) issues.push({ code: 'IMPORT_ACTIVITY_PAYLOAD_INVALID', path: `${path}.payload` });
    else issues.push({ code: 'IMPORT_ACTIVITY_PAYLOAD_INVALID', path: `${path}.payload` });
    return null;
  }
  return { type, position: index, payload, estimatedDurationMin, skillCodes };
}

function normDescription(v: unknown, path: string, issues: ImportIssue[]): string | null {
  if (v === undefined || v === null) return null;
  if (isStr(v) && v.length <= 2000) return v.trim() ? v.trim() : null;
  invalid(issues, path);
  return null;
}
function normSortOrder(v: unknown, path: string, issues: ImportIssue[], required = false): number {
  if (v === undefined || v === null) {
    if (required) invalid(issues, path);
    return 0;
  }
  if (isIntGte0(v)) return v;
  invalid(issues, path);
  return 0;
}
/** Skill-code reference list — Subject-scoped stable code syntax (≤80, NO_CONTROL). Rejects duplicates (strict; §4/5). */
function normSkillCodeList(v: unknown, path: string, max: number, issues: ImportIssue[]): string[] {
  return normRefList(v, path, max, issues, (t) => t.length >= 1 && t.length <= 80 && NO_CONTROL.test(t));
}
/** Prerequisite content-key reference list — SAME syntax as Lesson.contentKey (≤200, CONTENT_KEY_RE), NOT skill-code
 *  rules. A valid 120-char contentKey is therefore a valid prerequisite reference. Rejects duplicates (strict; §4/5). */
function normContentKeyList(v: unknown, path: string, max: number, issues: ImportIssue[]): string[] {
  return normRefList(v, path, max, issues, (t) => t.length >= 1 && t.length <= 200 && CONTENT_KEY_RE.test(t));
}
/**
 * Strict reference-list normalizer. Enforces the list-length limit, per-item syntax, AND package-local uniqueness:
 * a duplicate entry is a validation issue, NOT silently collapsed — apply relies on the parser guaranteeing
 * de-duplicated lists (no LessonSkill/ActivitySkill/LessonPrerequisite unique conflict can surface at write time).
 */
function normRefList(v: unknown, path: string, max: number, issues: ImportIssue[], ok: (t: string) => boolean): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    invalid(issues, path);
    return [];
  }
  if (v.length > max) issues.push({ code: 'IMPORT_LIMIT_EXCEEDED', path });
  const out: string[] = [];
  const seen = new Set<string>();
  v.forEach((item, i) => {
    if (!isStr(item)) return void invalid(issues, `${path}[${i}]`);
    const t = item.trim();
    if (!ok(t)) return void invalid(issues, `${path}[${i}]`);
    if (seen.has(t)) return void invalid(issues, `${path}[${i}]`); // duplicate reference — strict, no silent dedup
    seen.add(t);
    out.push(t);
  });
  return out;
}
