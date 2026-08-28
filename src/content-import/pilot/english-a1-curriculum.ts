import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivityType } from '@prisma/client';
import { parseImportDocument } from '../import-parser';
import type { ImportPlan, PlanLesson } from '../import-contract';
import { PILOT_DIR, PILOT_CONTENT_KEYS } from './english-a1-pilot';

/**
 * English A1 FOUNDATION EXPANSION (A1 curriculum milestone) — the authoring source loader + structural validator for
 * the roadmap points added ON TOP of the 12-lesson pilot. Same canonical importer parser (`parseImportDocument`);
 * this module only owns the expansion's cross-file invariants + the RoadmapPoint plan (skill/prereq/lesson mapping)
 * so the provisioner, the CLI validator and the tests share one source of truth.
 *
 * Nothing here inserts content — it is a plan. The provisioner drives the REAL authoring workflow (import → publish →
 * point-authoring draft → review → publish) so every new point passes the same Content Quality gate as staff-authored
 * content. Files are AI-ASSISTED drafts carrying server-only answerKey; they require human review before publication.
 */

/** New Topic packages, in import order (each may reference earlier pilot/curriculum lessons as prerequisites). */
export const CURRICULUM_IMPORT_FILES = [
  '05-articles-and-plurals.json',
  '06-there-is-and-place.json',
  '07-ability-and-frequency.json',
] as const;

/** New Topics created under the A1 module (idempotent by title). */
export interface CurriculumTopic {
  title: string;
  description: string;
  order: number;
  importFile: string;
}
export const CURRICULUM_TOPICS: CurriculumTopic[] = [
  { title: 'Otlar: artikl va ko‘plik', description: 'a/an/the va otlarning ko‘plik shakli.', order: 50, importFile: '05-articles-and-plurals.json' },
  { title: 'Bu yerda nima bor?', description: 'there is/there are va o‘rin predloglari.', order: 60, importFile: '06-there-is-and-place.json' },
  { title: 'Imkoniyat va chastota', description: 'can/can’t va takror ravishlari.', order: 70, importFile: '07-ability-and-frequency.json' },
];

/** The 6 new lesson contentKeys (013 → 018), one lesson per new point. */
export const CURRICULUM_CONTENT_KEYS = [
  'ENG-A1-013-ARTICLES',
  'ENG-A1-014-PLURALS',
  'ENG-A1-015-THERE-IS-ARE',
  'ENG-A1-016-PREP-PLACE',
  'ENG-A1-017-CAN-ABILITY',
  'ENG-A1-018-FREQUENCY-ADVERBS',
] as const;

/** The 6 new skills (all GRAMMAR domain — the only A1 domain with defensible objective evidence besides VOCABULARY). */
export const CURRICULUM_SKILL_CODES = [
  'ENG-A1-ARTICLES',
  'ENG-A1-PLURALS',
  'ENG-A1-THERE-IS-ARE',
  'ENG-A1-PREP-PLACE',
  'ENG-A1-CAN-ABILITY',
  'ENG-A1-FREQUENCY-ADVERBS',
] as const;

export const CURRICULUM_DOMAIN_CODE = 'GRAMMAR';

/**
 * Honest mastery evidence for A1 objective grammar. Objective single_choice items over varied contexts defensibly
 * demonstrate RECOGNITION + CONTROLLED-PRODUCTION of a grammatical form — they do NOT prove free/independent
 * production (typed output, speaking), so we deliberately do NOT claim 'free-production' (the pilot over-claimed it).
 */
export const CURRICULUM_EVIDENCE_KINDS = ['recognition', 'controlled-production'] as const;
export const CURRICULUM_MASTERY_THRESHOLD_BP = 8000; // 80%
export const CURRICULUM_MASTERY_MIN_INDEPENDENCE = 1;
export const CURRICULUM_MASTERY_POLICY_VERSION = 'v2-a1-curriculum-mastery-v1';

/** One RoadmapPoint per new grammar concept. `prerequisitePointKeys` may reference EXISTING roadmap points. */
export interface CurriculumPointSpec {
  pointKey: string;
  title: string;
  canDo: string[];
  sortOrder: number;
  estimatedEffortMin: number;
  skillCode: string; // the REQUIRED skill (1:1 with the lesson's mastery skill)
  lessonContentKey: string; // the lesson whose activities the blueprint orchestrates
  prerequisitePointKeys: string[];
}

/** Existing roadmap point keys this expansion builds upon (from provision-v2-english-a1-roadmap.ts). */
export const EXISTING_POINT_VERB_BE = 'ENG-A1-VERB-BE';
export const EXISTING_POINT_PRESENT_SIMPLE = 'ENG-A1-PRESENT-SIMPLE';

/**
 * The expansion plan. A deliberately BRANCHING prerequisite graph: ARTICLES, PREP-PLACE and CAN-ABILITY all unlock
 * from VERB-BE, so multiple new points become AVAILABLE at once — which is what proves one-new-point-per-day and
 * repair/review-over-new-learning with real curriculum (not a synthetic graph).
 */
export const CURRICULUM_POINT_PLAN: CurriculumPointSpec[] = [
  {
    pointKey: 'ENG-A1-ARTICLES', title: 'Artikllar: a / an / the', sortOrder: 50, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-ARTICLES', lessonContentKey: 'ENG-A1-013-ARTICLES', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['a va an artikllarini tovushga qarab to‘g‘ri tanlash', 'the artiklini ma’lum, aniq ot oldida ishlatish'],
  },
  {
    pointKey: 'ENG-A1-PLURALS', title: 'Otlarning ko‘plik shakli', sortOrder: 55, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-PLURALS', lessonContentKey: 'ENG-A1-014-PLURALS', prerequisitePointKeys: ['ENG-A1-ARTICLES'],
    canDo: ['-s / -es / -ies qoidalari bilan ko‘plik yasash', 'qoidasiz ko‘pliklarni (children, men, women) tanib olish'],
  },
  {
    pointKey: 'ENG-A1-THERE-IS-ARE', title: 'There is / There are', sortOrder: 65, estimatedEffortMin: 20,
    skillCode: 'ENG-A1-THERE-IS-ARE', lessonContentKey: 'ENG-A1-015-THERE-IS-ARE', prerequisitePointKeys: ['ENG-A1-PLURALS'],
    canDo: ['there is (birlik) va there are (ko‘plik)ni to‘g‘ri tanlash', 'biror joyda nima borligini aytish'],
  },
  {
    pointKey: 'ENG-A1-PREP-PLACE', title: 'O‘rin predloglari', sortOrder: 70, estimatedEffortMin: 20,
    skillCode: 'ENG-A1-PREP-PLACE', lessonContentKey: 'ENG-A1-016-PREP-PLACE', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['in/on/under/next to bilan narsa qayerdaligini aytish'],
  },
  {
    pointKey: 'ENG-A1-CAN-ABILITY', title: 'can / can’t — qobiliyat', sortOrder: 80, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-CAN-ABILITY', lessonContentKey: 'ENG-A1-017-CAN-ABILITY', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['can/can’t bilan qobiliyat haqida gapirish', 'Can...? savolini tuzish'],
  },
  {
    pointKey: 'ENG-A1-FREQUENCY-ADVERBS', title: 'Takror ravishlari', sortOrder: 110, estimatedEffortMin: 20,
    skillCode: 'ENG-A1-FREQUENCY-ADVERBS', lessonContentKey: 'ENG-A1-018-FREQUENCY-ADVERBS', prerequisitePointKeys: [EXISTING_POINT_PRESENT_SIMPLE],
    canDo: ['always/usually/sometimes/never bilan qanchalik tez-tez ekanini aytish', 'ravishni gapda to‘g‘ri joylashtirish'],
  },
];

const MARKDOWN_TYPES = new Set<ActivityType>([ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]);
const OBJECTIVE_TYPES = new Set<ActivityType>([ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]);
const SUPPORTED_TYPES = new Set<ActivityType>([...MARKDOWN_TYPES, ...OBJECTIVE_TYPES]);
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;
const LEAK_SENTINELS = ['answerKey', 'correctOptionIds'];

export interface CurriculumPackageParse {
  file: string;
  plan: ImportPlan;
  issues: string[];
}

export function parseCurriculumPackages(): CurriculumPackageParse[] {
  return CURRICULUM_IMPORT_FILES.map((file) => {
    const raw = JSON.parse(readFileSync(resolve(PILOT_DIR, file), 'utf8')) as unknown;
    try {
      const { plan, issues } = parseImportDocument(raw);
      return { file, plan, issues: issues.map((i) => `${file}: ${i.code} @ ${i.path}`) };
    } catch (e) {
      const code = (e as { importCode?: string }).importCode ?? 'PARSE_ERROR';
      return { file, plan: { provenance: { source: 'HUMAN' }, skills: [], lessons: [] }, issues: [`${file}: HARD ${code}`] };
    }
  });
}

export interface CurriculumValidation {
  ok: boolean;
  issues: string[];
  summary: { topics: number; lessons: number; activities: number; objectiveActivities: number; skills: number; points: number };
}

/**
 * Structural validation of the expansion: canonical parse + cross-file invariants + point-plan coherence. Never
 * returns answerKey/payload/markdown. Proves each new lesson has real teaching (explanation/example), a mastery test,
 * objective practice, honest skill mapping, and that every point maps a declared skill + a real lesson + resolvable
 * prerequisites (existing pilot point or an earlier curriculum point).
 */
export function validateCurriculum(): CurriculumValidation {
  const issues: string[] = [];
  const packages = parseCurriculumPackages();
  for (const p of packages) issues.push(...p.issues);

  const lessonByKey = new Map<string, PlanLesson>();
  const declaredSkills = new Set<string>();
  const availableLessonKeys = new Set<string>(PILOT_CONTENT_KEYS); // pilot lessons are valid prerequisite targets
  let activityCount = 0;
  let objectiveActivityCount = 0;

  for (const p of packages) {
    if (p.plan.provenance.source !== 'AI_ASSISTED') issues.push(`${p.file}: provenance.source is "${p.plan.provenance.source}", expected AI_ASSISTED`);
    for (const s of p.plan.skills) declaredSkills.add(s.code);
    for (const lesson of p.plan.lessons) {
      lessonByKey.set(lesson.contentKey, lesson);
      const acts = lesson.revision.activities;
      activityCount += acts.length;

      if (lesson.skillCodes.length < 1) issues.push(`${lesson.contentKey}: no LessonSkill mapping`);
      if (!acts.some((a) => a.type === ActivityType.EXPLANATION || a.type === ActivityType.EXAMPLE)) issues.push(`${lesson.contentKey}: no EXPLANATION/EXAMPLE`);
      if (!acts.some((a) => a.type === ActivityType.MASTERY_TEST)) issues.push(`${lesson.contentKey}: no MASTERY_TEST`);
      if (!acts.some((a) => a.type === ActivityType.PRACTICE)) issues.push(`${lesson.contentKey}: no PRACTICE`);

      acts.forEach((a, i) => {
        if (!SUPPORTED_TYPES.has(a.type)) issues.push(`${lesson.contentKey}[${i}]: unsupported activity type ${a.type}`);
        if (OBJECTIVE_TYPES.has(a.type)) {
          objectiveActivityCount++;
          if (a.skillCodes.length < 1) issues.push(`${lesson.contentKey}[${i}] (${a.type}): objective activity has no skillCode`);
        }
        if (a.estimatedDurationMin == null) issues.push(`${lesson.contentKey}[${i}]: missing estimatedDurationMin`);
        if (MARKDOWN_TYPES.has(a.type)) {
          const md = (a.payload as { markdown?: unknown }).markdown;
          if (typeof md === 'string') {
            if (HTML_TAG_RE.test(md)) issues.push(`${lesson.contentKey}[${i}]: raw HTML in Markdown`);
            for (const s of LEAK_SENTINELS) if (md.includes(s)) issues.push(`${lesson.contentKey}[${i}]: leakage sentinel "${s}"`);
          }
        }
      });
      availableLessonKeys.add(lesson.contentKey);
      for (const pre of lesson.prerequisiteContentKeys) if (!availableLessonKeys.has(pre)) issues.push(`${lesson.contentKey}: prerequisite ${pre} not a pilot/earlier lesson`);
    }
  }

  // Counts + expected keys.
  for (const key of CURRICULUM_CONTENT_KEYS) if (!lessonByKey.has(key)) issues.push(`missing expected lesson ${key}`);
  for (const key of lessonByKey.keys()) if (!CURRICULUM_CONTENT_KEYS.includes(key as (typeof CURRICULUM_CONTENT_KEYS)[number])) issues.push(`unexpected lesson ${key}`);
  for (const code of CURRICULUM_SKILL_CODES) if (!declaredSkills.has(code)) issues.push(`missing expected skill ${code}`);

  // Point plan coherence: each point maps a declared skill, a real lesson (which maps that skill + has a mastery test
  // carrying the skill), and resolvable prerequisites (existing pilot point or an earlier curriculum point).
  const planPointKeys = new Set(CURRICULUM_POINT_PLAN.map((p) => p.pointKey));
  const existingPointKeys = new Set([EXISTING_POINT_VERB_BE, EXISTING_POINT_PRESENT_SIMPLE, 'ENG-A1-GREETINGS-INTRO', 'ENG-A1-PERSONAL-INFO', 'ENG-A1-FAMILY-POSSESSION']);
  const seenPointKeys = new Set<string>();
  for (const spec of CURRICULUM_POINT_PLAN) {
    if (seenPointKeys.has(spec.pointKey)) issues.push(`duplicate point ${spec.pointKey}`);
    seenPointKeys.add(spec.pointKey);
    if (spec.canDo.length === 0) issues.push(`${spec.pointKey}: empty canDo`);
    if (!declaredSkills.has(spec.skillCode)) issues.push(`${spec.pointKey}: skill ${spec.skillCode} not declared`);
    const lesson = lessonByKey.get(spec.lessonContentKey);
    if (!lesson) issues.push(`${spec.pointKey}: lesson ${spec.lessonContentKey} missing`);
    else {
      if (!lesson.skillCodes.includes(spec.skillCode)) issues.push(`${spec.pointKey}: lesson does not map skill ${spec.skillCode}`);
      const masterySkills = new Set(lesson.revision.activities.filter((a) => a.type === ActivityType.MASTERY_TEST).flatMap((a) => a.skillCodes));
      if (!masterySkills.has(spec.skillCode)) issues.push(`${spec.pointKey}: no MASTERY_TEST carries skill ${spec.skillCode} (mastery would be unsatisfiable)`);
    }
    for (const pre of spec.prerequisitePointKeys) if (!planPointKeys.has(pre) && !existingPointKeys.has(pre)) issues.push(`${spec.pointKey}: prerequisite point ${pre} is neither an existing nor an earlier curriculum point`);
  }

  const ok = issues.length === 0;
  return { ok, issues, summary: { topics: packages.length, lessons: lessonByKey.size, activities: activityCount, objectiveActivities: objectiveActivityCount, skills: declaredSkills.size, points: CURRICULUM_POINT_PLAN.length } };
}
