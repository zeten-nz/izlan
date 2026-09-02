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
  '08-everyday-grammar.json',
  '09-food-and-context.json',
  '10-people-and-objects.json',
  '11-comparison-and-past.json',
  '12-home-and-jobs.json',
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
  { title: 'Kundalik grammatika', description: 'this/that/these/those, Present Continuous va savol so‘zlari.', order: 80, importFile: '08-everyday-grammar.json' },
  { title: 'Ovqat va muloqot', description: 'ovqat/ichimlik so‘zlari, menyu o‘qish va muloyim so‘rov.', order: 90, importFile: '09-food-and-context.json' },
  { title: 'Odamlar va narsalar', description: 'ob‘ekt olmoshlari va egalik s.', order: 100, importFile: '10-people-and-objects.json' },
  { title: 'Taqqoslash va o‘tmish', description: 'qiyosiy daraja va was/were.', order: 110, importFile: '11-comparison-and-past.json' },
  { title: 'Uy va kasblar', description: 'uy/kasb matnlarini o‘qib tushunish (reading).', order: 120, importFile: '12-home-and-jobs.json' },
];

/** The new lesson contentKeys (013 → 028), one lesson per new point. */
export const CURRICULUM_CONTENT_KEYS = [
  'ENG-A1-013-ARTICLES',
  'ENG-A1-014-PLURALS',
  'ENG-A1-015-THERE-IS-ARE',
  'ENG-A1-016-PREP-PLACE',
  'ENG-A1-017-CAN-ABILITY',
  'ENG-A1-018-FREQUENCY-ADVERBS',
  'ENG-A1-019-DEMONSTRATIVES',
  'ENG-A1-020-PRESENT-CONTINUOUS',
  'ENG-A1-021-QUESTION-WORDS',
  'ENG-A1-022-FOOD-DRINKS',
  'ENG-A1-023-OBJECT-PRONOUNS',
  'ENG-A1-024-POSSESSIVE-S',
  'ENG-A1-025-COMPARATIVES',
  'ENG-A1-026-WAS-WERE',
  'ENG-A1-027-HOME',
  'ENG-A1-028-JOBS',
] as const;

/** The new skills. GRAMMAR by default; FOOD-VOCAB=VOCABULARY; HOME/JOBS=READING (reading-comprehension evidence). */
export const CURRICULUM_SKILL_CODES = [
  'ENG-A1-ARTICLES',
  'ENG-A1-PLURALS',
  'ENG-A1-THERE-IS-ARE',
  'ENG-A1-PREP-PLACE',
  'ENG-A1-CAN-ABILITY',
  'ENG-A1-FREQUENCY-ADVERBS',
  'ENG-A1-DEMONSTRATIVES',
  'ENG-A1-PRESENT-CONTINUOUS',
  'ENG-A1-QUESTION-WORDS',
  'ENG-A1-FOOD-VOCAB',
  'ENG-A1-OBJECT-PRONOUNS',
  'ENG-A1-POSSESSIVE-S',
  'ENG-A1-COMPARATIVES',
  'ENG-A1-WAS-WERE',
  'ENG-A1-HOME-VOCAB',
  'ENG-A1-JOBS-VOCAB',
] as const;

/** Default primary domain for a curriculum skill; a point spec may override via `skillDomainCode`. */
export const CURRICULUM_DOMAIN_CODE = 'GRAMMAR';

/**
 * Honest mastery evidence for A1 objective grammar. Objective single_choice items over varied contexts defensibly
 * demonstrate RECOGNITION + CONTROLLED-PRODUCTION of a grammatical form — they do NOT prove free/independent
 * production (typed output, speaking), so we deliberately do NOT claim 'free-production' (the pilot over-claimed it).
 */
export const CURRICULUM_EVIDENCE_KINDS = ['recognition', 'controlled-production'] as const;
/**
 * A point whose MASTERY_TEST evidence is STRUCTURED production requires controlled-production ONLY at independence 2 —
 * recognition (choice) can never satisfy it. Used by every structured-production point (PREP-PLACE + the wave-2 points).
 */
export const STRUCTURED_MASTERY_EVIDENCE_KINDS = ['controlled-production'] as const;
/** Back-compat alias (the original PREP-PLACE dogfood). Identical to STRUCTURED_MASTERY_EVIDENCE_KINDS. */
export const PREP_PLACE_MASTERY_EVIDENCE_KINDS = STRUCTURED_MASTERY_EVIDENCE_KINDS;
/**
 * A READING point proves comprehension of a visible text — its mastery evidence is reading-comprehension ONLY
 * (independence 1, receptive). A plain grammar-recognition activity cannot satisfy it (readiness checks the kind), so
 * reading competence is never fabricated from unrelated grammar questions.
 */
export const READING_MASTERY_EVIDENCE_KINDS = ['reading-comprehension'] as const;
export const READING_MASTERY_MIN_INDEPENDENCE = 1;
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
  /**
   * Optional per-point mastery override. A point whose lesson uses STRUCTURED production for its mastery evidence
   * genuinely requires controlled-production at independence 2 — recognition (choice) can no longer satisfy it. Points
   * without an override keep the default recognition gate ([recognition, controlled-production] @ independence 1).
   */
  masteryEvidenceKinds?: readonly string[];
  masteryMinIndependence?: number;
  /** Primary SubjectDomain for this point's skill (default GRAMMAR). VOCABULARY for word-in-context points. */
  skillDomainCode?: string;
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
    canDo: ['in/on/under/next to bilan narsa qayerdaligini aytish', 'o‘rin predlogli gapni so‘zlardan tuzish (tuzilma ishlab chiqarish)'],
    // Dogfood: the FIRST non-Present-Simple A1 point taught via STRUCTURED production. Its mastery evidence is
    // sentence_order + fill_blank, so it honestly requires controlled-production @ independence 2 (Scenario C).
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
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

  // ── Wave 2: structured-production-first everyday grammar + vocabulary-in-context ──
  {
    pointKey: 'ENG-A1-DEMONSTRATIVES', title: 'this / that / these / those', sortOrder: 60, estimatedEffortMin: 16,
    skillCode: 'ENG-A1-DEMONSTRATIVES', lessonContentKey: 'ENG-A1-019-DEMONSTRATIVES', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['yaqin/uzoq va birlik/ko‘plikka qarab narsani ko‘rsatish', 'this/that/these/those ni gapda to‘g‘ri qo‘llash'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-PRESENT-CONTINUOUS', title: 'Present Continuous (hozir)', sortOrder: 120, estimatedEffortMin: 20,
    skillCode: 'ENG-A1-PRESENT-CONTINUOUS', lessonContentKey: 'ENG-A1-020-PRESENT-CONTINUOUS', prerequisitePointKeys: [EXISTING_POINT_PRESENT_SIMPLE],
    canDo: ['am/is/are + fe‘l-ing bilan hozir bo‘layotgan ishni aytish', 'egaga mos am/is/are tanlash'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-QUESTION-WORDS', title: 'Savol so‘zlari', sortOrder: 115, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-QUESTION-WORDS', lessonContentKey: 'ENG-A1-021-QUESTION-WORDS', prerequisitePointKeys: [EXISTING_POINT_PRESENT_SIMPLE],
    canDo: ['what/where/who/when/how bilan ma‘lumot so‘rash', 'savol so‘zi + do/does bilan savol tuzish'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-FOOD-DRINKS', title: 'Ovqat va ichimliklar', sortOrder: 90, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-FOOD-VOCAB', lessonContentKey: 'ENG-A1-022-FOOD-DRINKS', prerequisitePointKeys: ['ENG-A1-THERE-IS-ARE'],
    canDo: ['keng tarqalgan ovqat/ichimlik so‘zlarini bilish', 'stolda nima borligini aytish va muloyim so‘rov qilish (I would like ...)'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
    skillDomainCode: 'VOCABULARY',
  },

  // ── Wave 3: object pronouns / possessive 's / comparatives / was-were (structured) + HOME/JOBS (reading) ──
  {
    pointKey: 'ENG-A1-OBJECT-PRONOUNS', title: 'Ob‘ekt olmoshlari', sortOrder: 45, estimatedEffortMin: 16,
    skillCode: 'ENG-A1-OBJECT-PRONOUNS', lessonContentKey: 'ENG-A1-023-OBJECT-PRONOUNS', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['fe‘l/predlogdan keyin to‘g‘ri olmoshni ishlatish (me/him/her/us/them)', 'ob‘ekt olmoshli gap tuzish'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-POSSESSIVE-S', title: 'Egalik ’s (Ali’s bag)', sortOrder: 46, estimatedEffortMin: 16,
    skillCode: 'ENG-A1-POSSESSIVE-S', lessonContentKey: 'ENG-A1-024-POSSESSIVE-S', prerequisitePointKeys: ['ENG-A1-FAMILY-POSSESSION'],
    canDo: ['narsa kimga tegishli ekanini aytish (ot + ’s)', 'egalik shaklli gap tuzish'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-COMPARATIVES', title: 'Qiyosiy daraja (-er than)', sortOrder: 130, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-COMPARATIVES', lessonContentKey: 'ENG-A1-025-COMPARATIVES', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['ikki narsa/odamni taqqoslash (taller/bigger than)', 'qiyosiy shaklli gap tuzish'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-WAS-WERE', title: 'was / were (o‘tgan zamon)', sortOrder: 135, estimatedEffortMin: 18,
    skillCode: 'ENG-A1-WAS-WERE', lessonContentKey: 'ENG-A1-026-WAS-WERE', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['kecha qayerda/qanday bo‘lganini aytish (was/were)', 'was/were bilan gap tuzish'],
    masteryEvidenceKinds: STRUCTURED_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: 2,
  },
  {
    pointKey: 'ENG-A1-HOME', title: 'Uy va xonalar (o‘qib tushunish)', sortOrder: 95, estimatedEffortMin: 14,
    skillCode: 'ENG-A1-HOME-VOCAB', lessonContentKey: 'ENG-A1-027-HOME', prerequisitePointKeys: ['ENG-A1-THERE-IS-ARE'],
    canDo: ['uy/xona tavsifini o‘qib tushunish', 'matndan aniq ma‘lumotni topish'],
    masteryEvidenceKinds: READING_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: READING_MASTERY_MIN_INDEPENDENCE,
    skillDomainCode: 'READING',
  },
  {
    pointKey: 'ENG-A1-JOBS', title: 'Kasblar (o‘qib tushunish)', sortOrder: 96, estimatedEffortMin: 14,
    skillCode: 'ENG-A1-JOBS-VOCAB', lessonContentKey: 'ENG-A1-028-JOBS', prerequisitePointKeys: [EXISTING_POINT_VERB_BE],
    canDo: ['qisqa shaxsiy profilni o‘qib tushunish', 'kasb va ish joyini matndan aniqlash'],
    masteryEvidenceKinds: READING_MASTERY_EVIDENCE_KINDS, masteryMinIndependence: READING_MASTERY_MIN_INDEPENDENCE,
    skillDomainCode: 'READING',
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
