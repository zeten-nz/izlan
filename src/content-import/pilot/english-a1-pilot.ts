import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivityType } from '@prisma/client';
import { parseImportDocument } from '../import-parser';
import type { ImportPlan, PlanLesson } from '../import-contract';

/**
 * English A1 pilot (Phase 2.2E) — repository authoring source loader + cross-file pilot validator.
 *
 * This is NOT a second content format or a second importer. Each Topic package is parsed through the EXACT canonical
 * importer parser (`parseImportDocument`); this module only adds pilot-level cross-file invariants (import order,
 * prerequisite chain, skill-name consistency, mastery/explanation coverage, learner-safety scans). Shared by the
 * `content:pilot:a1:validate` script and the pilot unit tests so there is one source of truth.
 *
 * The pilot JSON files are AI-ASSISTED authoring drafts; they carry server-only answerKey values and require human
 * (Methodist/owner) review before any real import or publication. They are never delivered to the browser.
 */

/** Resolve the pilot content directory from source layout, falling back to the process cwd (repo root). */
function resolvePilotDir(): string {
  const fromSrc = resolve(__dirname, '../../../content/pilots/english-a1/v1');
  if (existsSync(fromSrc)) return fromSrc;
  return resolve(process.cwd(), 'content/pilots/english-a1/v1');
}

export const PILOT_DIR = resolvePilotDir();

/** Import order — Topic packages MUST be imported in this exact order (later packages reference earlier lessons). */
export const PILOT_IMPORT_FILES = [
  '01-introductions-and-be.json',
  '02-personal-information.json',
  '03-family-and-possession.json',
  '04-daily-routines.json',
] as const;

/** The approved immutable 12-lesson contentKey sequence (001 → 012). */
export const PILOT_CONTENT_KEYS = [
  'ENG-A1-001-GREETINGS',
  'ENG-A1-002-SUBJECT-PRONOUNS',
  'ENG-A1-003-BE-AFFIRMATIVE',
  'ENG-A1-004-BE-NEGATIVE',
  'ENG-A1-005-BE-QUESTIONS',
  'ENG-A1-006-NUMBERS-PERSONAL-INFO',
  'ENG-A1-007-POSSESSIVE-ADJECTIVES',
  'ENG-A1-008-FAMILY',
  'ENG-A1-009-HAVE-HAS',
  'ENG-A1-010-PRESENT-SIMPLE-AFFIRMATIVE',
  'ENG-A1-011-PRESENT-SIMPLE-NEGATIVE',
  'ENG-A1-012-PRESENT-SIMPLE-QUESTIONS',
] as const;

/** Expected linear prerequisite chain: 001 has none; each later lesson requires exactly the previous one. */
export const PILOT_PREREQUISITE_CHAIN: { lesson: string; requires: string | null }[] = PILOT_CONTENT_KEYS.map((key, i) => ({
  lesson: key,
  requires: i === 0 ? null : PILOT_CONTENT_KEYS[i - 1]!,
}));

export const EXPECTED = {
  pilotVersion: 'english-a1-pilot/v1',
  provenanceSource: 'AI_ASSISTED',
  topics: 4,
  lessons: 12,
  activities: 114,
  skills: 13,
} as const;

const BE_OR_PERSONAL_INFO = new Set(['ENG-A1-BE-AFFIRMATIVE', 'ENG-A1-BE-NEGATIVE', 'ENG-A1-BE-QUESTIONS', 'ENG-A1-PERSONAL-INFO']);
const POSSESSIVE_OR_FAMILY = new Set(['ENG-A1-POSSESSIVE-ADJECTIVES', 'ENG-A1-FAMILY-VOCAB']);
const PRESENT_SIMPLE = new Set(['ENG-A1-PRESENT-SIMPLE-AFFIRMATIVE', 'ENG-A1-PRESENT-SIMPLE-NEGATIVE', 'ENG-A1-PRESENT-SIMPLE-QUESTIONS']);
/** The Lesson 12 cumulative multiple_choice item measures each of these — its ActivitySkill mapping must not regress. */
export const LESSON_12_CUMULATIVE_SKILLS = ['ENG-A1-BE-QUESTIONS', 'ENG-A1-PERSONAL-INFO', 'ENG-A1-POSSESSIVE-ADJECTIVES', 'ENG-A1-HAVE-HAS', 'ENG-A1-PRESENT-SIMPLE-NEGATIVE'] as const;

const MARKDOWN_TYPES = new Set<ActivityType>([ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]);
const OBJECTIVE_TYPES = new Set<ActivityType>([ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]);
const SUPPORTED_TYPES = new Set<ActivityType>([...MARKDOWN_TYPES, ...OBJECTIVE_TYPES]);
// Conservative HTML-tag detector (our restricted Markdown must contain no raw HTML).
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;
// Answer-key leakage sentinels that must never appear inside authored Markdown prose.
const LEAK_SENTINELS = ['answerKey', 'correctOptionIds'];

export interface ManifestTopic {
  order: number;
  title: string;
  description?: string;
  importFile: string;
  lessonContentKeys: string[];
}
export interface PilotManifest {
  pilotVersion: string;
  subject: string;
  track: string;
  level: string;
  module: string;
  teachingLanguage: string;
  targetLanguage: string;
  lessonCount: number;
  topicCount: number;
  skillCount: number;
  importOrder: string[];
  topics: ManifestTopic[];
  skills: { code: string; name: string }[];
}

export interface PackageParse {
  file: string;
  raw: unknown;
  plan: ImportPlan;
  issues: string[]; // structural issue codes from parseImportDocument, prefixed with the file for context
}

export function loadManifest(): PilotManifest {
  return JSON.parse(readFileSync(resolve(PILOT_DIR, 'manifest.json'), 'utf8')) as PilotManifest;
}

/** Parse every Topic package through the canonical importer parser (no DB). Never throws — a hard parser error is
 *  recorded as an issue so the caller can report the whole pilot's status at once. */
export function parsePackages(): PackageParse[] {
  return PILOT_IMPORT_FILES.map((file) => {
    const raw = JSON.parse(readFileSync(resolve(PILOT_DIR, file), 'utf8')) as unknown;
    try {
      const { plan, issues } = parseImportDocument(raw);
      return { file, raw, plan, issues: issues.map((i) => `${file}: ${i.code} @ ${i.path}`) };
    } catch (e) {
      const code = (e as { importCode?: string }).importCode ?? 'PARSE_ERROR';
      return { file, raw, plan: { provenance: { source: 'HUMAN' }, skills: [], lessons: [] }, issues: [`${file}: HARD ${code}`] };
    }
  });
}

export interface PilotSummary {
  pilotVersion: string;
  topics: number;
  lessons: number;
  activities: number;
  objectiveActivities: number;
  skills: number;
  estimatedDurationMin: number; // SUM(Activity.estimatedDurationMin) across the actual normalized packages
  valid: boolean;
}

export interface PilotValidation {
  ok: boolean;
  summary: PilotSummary;
  issues: string[];
}

/**
 * Full pilot validation: canonical parse of every package PLUS the cross-file pilot invariants (§40). Returns a safe
 * summary (counts only) and a flat list of human-readable issues. NEVER returns answerKey / payload / Markdown bodies.
 */
export function validatePilot(): PilotValidation {
  const issues: string[] = [];
  const manifest = loadManifest();
  const packages = parsePackages();

  // Structural: every package parses with zero canonical issues.
  for (const p of packages) issues.push(...p.issues);

  const allLessons: { key: string; lesson: PlanLesson; file: string }[] = [];
  const skillNameByCode = new Map<string, string>();
  const availableCodes = new Set<string>(); // codes declared in this-or-an-earlier package (import-order resolvability)
  let activityCount = 0;
  let objectiveActivityCount = 0;
  let estimatedDurationMin = 0;

  for (const p of packages) {
    // Provenance (TD-254): the whole pilot is AI-assisted, not HUMAN.
    if (p.plan.provenance.source !== EXPECTED.provenanceSource) {
      issues.push(`${p.file}: provenance.source is "${p.plan.provenance.source}", expected ${EXPECTED.provenanceSource}`);
    }
    for (const s of p.plan.skills) {
      const prev = skillNameByCode.get(s.code);
      if (prev !== undefined && prev !== s.name) issues.push(`Skill code ${s.code} has inconsistent names: "${prev}" vs "${s.name}"`);
      else skillNameByCode.set(s.code, s.name);
      availableCodes.add(s.code);
    }
    for (const lesson of p.plan.lessons) {
      allLessons.push({ key: lesson.contentKey, lesson, file: p.file });
      const acts = lesson.revision.activities;
      activityCount += acts.length;

      // Every referenced skill code must be declared in this or an earlier package (import order resolves it).
      for (const code of lesson.skillCodes) if (!availableCodes.has(code)) issues.push(`${lesson.contentKey}: skillCode ${code} not declared in this or an earlier package`);

      // Per-lesson pedagogical/structural invariants.
      if (lesson.skillCodes.length < 1) issues.push(`${lesson.contentKey}: no LessonSkill mapping`);
      const hasExplanationOrExample = acts.some((a) => a.type === ActivityType.EXPLANATION || a.type === ActivityType.EXAMPLE);
      if (!hasExplanationOrExample) issues.push(`${lesson.contentKey}: no EXPLANATION or EXAMPLE activity`);
      if (!acts.some((a) => a.type === ActivityType.MASTERY_TEST)) issues.push(`${lesson.contentKey}: no MASTERY_TEST activity`);
      if (!acts.some((a) => OBJECTIVE_TYPES.has(a.type) && a.type !== ActivityType.MINI_QUESTION)) {
        issues.push(`${lesson.contentKey}: no objective practice (PRACTICE/MASTERY_TEST) activity`);
      }

      acts.forEach((a, i) => {
        if (!SUPPORTED_TYPES.has(a.type)) issues.push(`${lesson.contentKey}[${i}]: unsupported activity type ${a.type}`);
        if (OBJECTIVE_TYPES.has(a.type)) {
          objectiveActivityCount++;
          if (a.skillCodes.length < 1) issues.push(`${lesson.contentKey}[${i}] (${a.type}): objective activity has no skillCode`);
          for (const code of a.skillCodes) if (!availableCodes.has(code)) issues.push(`${lesson.contentKey}[${i}]: activity skillCode ${code} not declared in this or an earlier package`);
        }
        if (a.estimatedDurationMin == null) issues.push(`${lesson.contentKey}[${i}]: missing estimatedDurationMin`);
        else estimatedDurationMin += a.estimatedDurationMin;
        if (MARKDOWN_TYPES.has(a.type)) {
          const md = (a.payload as { markdown?: unknown }).markdown;
          if (typeof md === 'string') {
            if (HTML_TAG_RE.test(md)) issues.push(`${lesson.contentKey}[${i}]: raw HTML detected in Markdown`);
            for (const sentinel of LEAK_SENTINELS) if (md.includes(sentinel)) issues.push(`${lesson.contentKey}[${i}]: leakage sentinel "${sentinel}" in Markdown`);
          }
        }
      });
    }
  }

  // Cross-file: counts.
  if (packages.length !== EXPECTED.topics) issues.push(`expected ${EXPECTED.topics} Topic packages, found ${packages.length}`);
  if (allLessons.length !== EXPECTED.lessons) issues.push(`expected ${EXPECTED.lessons} lessons, found ${allLessons.length}`);
  if (skillNameByCode.size !== EXPECTED.skills) issues.push(`expected ${EXPECTED.skills} distinct skill codes, found ${skillNameByCode.size}`);

  // Cross-file: contentKeys unique and exactly the approved set.
  const seen = new Set<string>();
  for (const l of allLessons) {
    if (seen.has(l.key)) issues.push(`duplicate lesson contentKey across files: ${l.key}`);
    seen.add(l.key);
  }
  const expectedKeys: readonly string[] = PILOT_CONTENT_KEYS;
  for (const key of expectedKeys) if (!seen.has(key)) issues.push(`missing expected contentKey: ${key}`);
  for (const l of allLessons) if (!expectedKeys.includes(l.key)) issues.push(`unexpected contentKey: ${l.key}`);

  // Cross-file: manifest lesson lists match the packages (order-sensitive).
  const filesByName = new Map(packages.map((p) => [p.file, p.plan.lessons.map((l) => l.contentKey)]));
  for (const t of manifest.topics) {
    const actual = filesByName.get(t.importFile);
    if (!actual) issues.push(`manifest topic references unknown file ${t.importFile}`);
    else if (JSON.stringify(actual) !== JSON.stringify(t.lessonContentKeys)) issues.push(`manifest lessonContentKeys for ${t.importFile} do not match the package`);
  }
  if (JSON.stringify(manifest.importOrder) !== JSON.stringify([...PILOT_IMPORT_FILES])) issues.push('manifest importOrder does not match the expected order');

  // Cross-file: exact prerequisite chain + no forward reference.
  const lessonByKey = new Map(allLessons.map((l) => [l.key, l.lesson]));
  const orderIndex = new Map<string, number>(PILOT_CONTENT_KEYS.map((k, i) => [k, i] as [string, number]));
  for (const { lesson, requires } of PILOT_PREREQUISITE_CHAIN) {
    const l = lessonByKey.get(lesson);
    if (!l) continue; // already reported missing
    const prereqs = l.prerequisiteContentKeys;
    const expected = requires === null ? [] : [requires];
    if (JSON.stringify(prereqs) !== JSON.stringify(expected)) {
      issues.push(`${lesson}: prerequisite mismatch — expected ${JSON.stringify(expected)}, found ${JSON.stringify(prereqs)}`);
    }
    for (const p of prereqs) {
      const pi = orderIndex.get(p);
      if (pi === undefined) issues.push(`${lesson}: prerequisite ${p} is not a pilot lesson`);
      else if (pi >= orderIndex.get(lesson)!) issues.push(`${lesson}: forward prerequisite ${p}`);
    }
  }

  // Lesson 06 — mastery must cover BOTH numbers and personal-info skills.
  const l06 = lessonByKey.get('ENG-A1-006-NUMBERS-PERSONAL-INFO');
  if (l06) {
    const masterySkills = new Set(l06.revision.activities.filter((a) => a.type === ActivityType.MASTERY_TEST).flatMap((a) => a.skillCodes));
    if (!masterySkills.has('ENG-A1-NUMBERS')) issues.push('ENG-A1-006: mastery does not cover ENG-A1-NUMBERS');
    if (!masterySkills.has('ENG-A1-PERSONAL-INFO')) issues.push('ENG-A1-006: mastery does not cover ENG-A1-PERSONAL-INFO');
  }

  // Lesson 12 — objective activities must retrieve prior knowledge (have/has, be/personal-info, possessive/family) in
  // addition to Present Simple (§14). ActivitySkill is the granular evidence authority.
  const l12 = lessonByKey.get('ENG-A1-012-PRESENT-SIMPLE-QUESTIONS');
  if (l12) {
    const objectiveSkills = new Set(l12.revision.activities.filter((a) => OBJECTIVE_TYPES.has(a.type)).flatMap((a) => a.skillCodes));
    if (!objectiveSkills.has('ENG-A1-HAVE-HAS')) issues.push('ENG-A1-012: no objective retrieval of ENG-A1-HAVE-HAS');
    if (![...objectiveSkills].some((c) => BE_OR_PERSONAL_INFO.has(c))) issues.push('ENG-A1-012: no objective retrieval of a to-be/personal-info skill');
    if (![...objectiveSkills].some((c) => POSSESSIVE_OR_FAMILY.has(c))) issues.push('ENG-A1-012: no objective retrieval of a possessive/family skill');
    if (![...objectiveSkills].some((c) => PRESENT_SIMPLE.has(c))) issues.push('ENG-A1-012: no objective Present Simple activity');

    // The cumulative multiple_choice item must map every material skill it measures (granular evidence, no silent regression).
    const cumulative = l12.revision.activities.find((a) => a.type === ActivityType.MASTERY_TEST && (a.payload as { format?: string }).format === 'multiple_choice');
    if (!cumulative) issues.push('ENG-A1-012: missing cumulative multiple_choice MASTERY_TEST');
    else for (const code of LESSON_12_CUMULATIVE_SKILLS) if (!cumulative.skillCodes.includes(code)) issues.push(`ENG-A1-012 cumulative item: missing ActivitySkill ${code}`);
  }

  const ok = issues.length === 0;
  return {
    ok,
    issues,
    summary: {
      pilotVersion: manifest.pilotVersion,
      topics: packages.length,
      lessons: allLessons.length,
      activities: activityCount,
      objectiveActivities: objectiveActivityCount,
      skills: skillNameByCode.size,
      estimatedDurationMin,
      valid: ok,
    },
  };
}
