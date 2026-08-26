/**
 * DEV-ONLY provisioning: reconstruct the working English A1 development curriculum + placement bridge in a dev DB.
 *
 * WHY THIS EXISTS (reproducibility): the real 12-lesson curriculum lives in content/pilots/english-a1/v1 and is loaded
 * through the CANONICAL content-authoring/import services (validate → apply DRAFT → submit-review → publish). The
 * placement DIAGNOSTIC, however, has no HTTP/admin authoring API (the runtime assessment module is read-only), and the
 * seeded diagnostic only measures the 3 fixture skills — so after a DB reset the roadmap would no longer surface the 12
 * real lessons. This tool re-imports/publishes the pilot via the real workflow AND (Prisma model APIs only, §7) ensures
 * a diagnostic version that measures all 13 pilot skills, then leaves currentVersionId pointing at it.
 *
 * It NEVER: runs in production, wipes the DB, deletes users/content, forces a lesson/container status, mutates a
 * published assessment version in place, or handles passwords/tokens/OTP. It is idempotent on the A1 natural keys.
 * The real curriculum is NOT copied into this file — only the diagnostic ITEMS (assessment content that has no authoring
 * pipeline) live here, exactly as the seed constructs its diagnostic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssessmentPurposeScope, ContentSource, RevisionStatus, ActivityType } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { ImportService } from '../content-import/import.service';
import type { SubjectService } from '../content-authoring/subject.service';
import type { HierarchyService } from '../content-authoring/hierarchy.service';
import type { HierarchyPublishService } from '../content-authoring/publish/hierarchy-publish.service';
import type { PublicationService } from '../content-authoring/publish/publication.service';
import { RUNTIME_SUBJECT, RUNTIME_TRACK } from './seed-runtime';
import { DEMO_ADMIN } from './seed-demo';
import { loadManifest, PILOT_DIR, PILOT_IMPORT_FILES, PILOT_CONTENT_KEYS, PILOT_PREREQUISITE_CHAIN } from '../content-import/pilot/english-a1-pilot';

// ── Diagnostic items: exactly one concise A1 objective per pilot skill (difficulty within profileScale [1,6]). ──
const ITEM_SCHEMA = 'placement-item/v1';
const sc = (prompt: string, options: { id: string; text: string }[], correctId: string) => ({ schemaVersion: ITEM_SCHEMA, format: 'single_choice', prompt, options, answerKey: { correctOptionIds: [correctId] } });

/** One diagnostic item per pilot skill. `skillCode` is the stable natural key used to resolve the Skill + for idempotency. */
export const A1_DIAGNOSTIC_ITEMS: { skillCode: string; difficulty: number; payload: object }[] = [
  { skillCode: 'ENG-A1-GREETINGS', difficulty: 2, payload: sc('Ertalab soat 9:00 da kimnidir uchratdingiz. Qaysi salom to‘g‘ri?', [{ id: 'a', text: 'Good morning!' }, { id: 'b', text: 'Good night!' }, { id: 'c', text: 'Goodbye!' }], 'a') },
  { skillCode: 'ENG-A1-SUBJECT-PRONOUNS', difficulty: 2, payload: sc('"The book" so‘zining o‘rniga qaysi olmosh keladi?', [{ id: 'a', text: 'he' }, { id: 'b', text: 'she' }, { id: 'c', text: 'it' }], 'c') },
  { skillCode: 'ENG-A1-BE-AFFIRMATIVE', difficulty: 3, payload: sc('She ___ a teacher.', [{ id: 'a', text: 'am' }, { id: 'b', text: 'is' }, { id: 'c', text: 'are' }], 'b') },
  { skillCode: 'ENG-A1-BE-NEGATIVE', difficulty: 3, payload: sc('He ___ at home. (u uyda emas)', [{ id: 'a', text: "isn't" }, { id: 'b', text: "aren't" }, { id: 'c', text: 'am not' }], 'a') },
  { skillCode: 'ENG-A1-BE-QUESTIONS', difficulty: 3, payload: sc('___ you from Bukhara?', [{ id: 'a', text: 'Are' }, { id: 'b', text: 'Do' }, { id: 'c', text: 'Is' }], 'a') },
  { skillCode: 'ENG-A1-NUMBERS', difficulty: 2, payload: sc("Qaysi son 'fifteen' ga to‘g‘ri keladi?", [{ id: 'a', text: '15' }, { id: 'b', text: '50' }, { id: 'c', text: '5' }], 'a') },
  { skillCode: 'ENG-A1-PERSONAL-INFO', difficulty: 3, payload: sc('"Where are you from?" savoliga qaysi javob mos?', [{ id: 'a', text: "I'm from Uzbekistan." }, { id: 'b', text: "I'm fine, thanks." }, { id: 'c', text: "I'm twenty." }], 'a') },
  { skillCode: 'ENG-A1-POSSESSIVE-ADJECTIVES', difficulty: 3, payload: sc('This is Laylo. ___ brother is a doctor. (uning)', [{ id: 'a', text: 'His' }, { id: 'b', text: 'Her' }, { id: 'c', text: 'He' }], 'b') },
  { skillCode: 'ENG-A1-FAMILY-VOCAB', difficulty: 2, payload: sc('Your father and mother are your ___.', [{ id: 'a', text: 'parents' }, { id: 'b', text: 'brothers' }, { id: 'c', text: 'sisters' }], 'a') },
  { skillCode: 'ENG-A1-HAVE-HAS', difficulty: 3, payload: sc('She ___ two sisters.', [{ id: 'a', text: 'have' }, { id: 'b', text: 'has' }, { id: 'c', text: 'haves' }], 'b') },
  { skillCode: 'ENG-A1-PRESENT-SIMPLE-AFFIRMATIVE', difficulty: 3, payload: sc('He ___ in a bank. (work)', [{ id: 'a', text: 'work' }, { id: 'b', text: 'works' }, { id: 'c', text: 'working' }], 'b') },
  { skillCode: 'ENG-A1-PRESENT-SIMPLE-NEGATIVE', difficulty: 4, payload: sc('She ___ coffee. (drink, inkor)', [{ id: 'a', text: "don't drink" }, { id: 'b', text: "doesn't drink" }, { id: 'c', text: "doesn't drinks" }], 'b') },
  { skillCode: 'ENG-A1-PRESENT-SIMPLE-QUESTIONS', difficulty: 4, payload: sc('___ he like tea?', [{ id: 'a', text: 'Do' }, { id: 'b', text: 'Does' }, { id: 'c', text: 'Is' }], 'b') },
];

export interface ProvisionEnv {
  nodeEnv: string | undefined;
  allowDevFixture: string | undefined;
}

/** Fail closed: forbidden in production; requires the existing ALLOW_DEV_FIXTURE=true dev opt-in. No secrets involved. */
export function assertProvisionAllowed(env: ProvisionEnv): void {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('dev:provision:english-a1 is forbidden in production');
  if ((env.allowDevFixture ?? '').trim() !== 'true') throw new Error('dev:provision:english-a1 requires ALLOW_DEV_FIXTURE=true');
}

export interface ProvisionDeps {
  prisma: PrismaService;
  subjects: SubjectService;
  hierarchy: HierarchyService;
  importer: ImportService;
  hierarchyPublish: HierarchyPublishService;
  publication: PublicationService;
}

export interface ProvisionResult {
  subjectId: string;
  topics: number;
  pilotLessonsPublished: number;
  pilotSkills: number;
  diagnostic: { versionNo: number; poolSize: number; distinctSkills: number; createdNewVersion: boolean };
}

const iso = (d: Date) => d.toISOString();

/**
 * Reconstruct the A1 dev curriculum + placement bridge. Assumes the runtime seed already created the subject/track/
 * level/module + the ADMIN actor (throws a clear error otherwise). Idempotent: safe to re-run.
 */
export async function provisionEnglishA1(deps: ProvisionDeps, env: ProvisionEnv): Promise<ProvisionResult> {
  assertProvisionAllowed(env);
  const { prisma } = deps;
  const manifest = loadManifest();

  // 0) Locate the seeded subject/module + ADMIN actor. Fail with guidance if the seed has not run.
  const subject = await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } });
  if (!subject) throw new Error(`subject ${RUNTIME_SUBJECT.slug} not found — run db:seed:runtime first`);
  const track = await prisma.track.findFirst({ where: { subjectId: subject.id, slug: RUNTIME_TRACK.slug } });
  const level = track && (await prisma.level.findFirst({ where: { trackId: track.id } }));
  const moduleRow = level && (await prisma.module.findFirst({ where: { levelId: level.id } }));
  if (!moduleRow) throw new Error('A1 module not found — run db:seed:runtime first');
  const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone } });
  if (!admin) throw new Error(`admin ${DEMO_ADMIN.phone} not found — run db:seed:runtime first`);
  const actor = admin.id;

  // 1) Assign the author to the subject (idempotent — required scope for the authoring services).
  await deps.subjects.assignUser(actor, subject.id, actor);

  // 2) Ensure the 4 pilot Topics (idempotent by title within the module).
  const topicIdByFile = new Map<string, string>();
  for (const t of manifest.topics) {
    const existing = await prisma.topic.findFirst({ where: { moduleId: moduleRow.id, title: t.title } });
    const id = existing ? existing.id : (await deps.hierarchy.createTopic(actor, moduleRow.id, { title: t.title, description: t.description, sortOrder: t.order })).id;
    topicIdByFile.set(t.importFile, id);
  }

  // 3) Import each package via the canonical importer (validate → apply DRAFT). Skip a file already imported.
  for (const file of PILOT_IMPORT_FILES) {
    const doc = JSON.parse(readFileSync(resolve(PILOT_DIR, file), 'utf8')) as unknown;
    const firstKey = (doc as { lessons: { contentKey: string }[] }).lessons[0].contentKey;
    if (await prisma.lesson.findUnique({ where: { contentKey: firstKey } })) continue; // already imported
    const validated = await deps.importer.validate(actor, topicIdByFile.get(file)!, doc);
    if (!(validated as { valid: boolean }).valid) throw new Error(`import validate failed for ${file}`);
    await deps.importer.apply(actor, topicIdByFile.get(file)!, doc);
  }

  // 4) Publish the 4 Topics (DRAFT → PUBLISHED; ancestors already PUBLISHED from the seed). Idempotent.
  for (const t of manifest.topics) {
    const topic = await prisma.topic.findUnique({ where: { id: topicIdByFile.get(t.importFile)! } });
    if (topic!.status === 'PUBLISHED') continue;
    await deps.hierarchyPublish.publishTopic(actor, topic!.id, { expectedUpdatedAt: iso(topic!.updatedAt) });
  }

  // 5) Review + publish every lesson in prerequisite order (001 → 012). Idempotent (skip already PUBLISHED).
  for (const { lesson: contentKey } of PILOT_PREREQUISITE_CHAIN) {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey }, include: { revisions: true } });
    if (!lesson) throw new Error(`lesson ${contentKey} not found after import`);
    if (lesson.status === 'PUBLISHED') continue;
    const rev = lesson.revisions.find((r) => r.version === 1) ?? lesson.revisions[0];
    if (rev.status === 'DRAFT') await deps.publication.submitReview(actor, rev.id, { expectedUpdatedAt: iso(rev.updatedAt) });
    const revFresh = await prisma.lessonRevision.findUnique({ where: { id: rev.id } });
    const lessonFresh = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    await deps.publication.publish(actor, rev.id, { expectedRevisionUpdatedAt: iso(revFresh!.updatedAt), expectedLessonUpdatedAt: iso(lessonFresh!.updatedAt) });
  }

  // 6) Diagnostic bridge (Prisma model APIs only — no authoring API exists for assessments).
  const diagnostic = await ensureDiagnosticCoversPilotSkills(deps, subject.id, actor);

  const pilotSkills = await prisma.skill.count({ where: { subjectId: subject.id, code: { in: A1_DIAGNOSTIC_ITEMS.map((i) => i.skillCode) } } });
  const pilotLessonsPublished = await prisma.lesson.count({ where: { contentKey: { in: [...PILOT_CONTENT_KEYS] }, status: 'PUBLISHED' } });
  return { subjectId: subject.id, topics: topicIdByFile.size, pilotLessonsPublished, pilotSkills, diagnostic };
}

/**
 * Ensure the subject's PUBLISHED DIAGNOSTIC has a CURRENT version whose pool measures all 13 pilot skills.
 * Idempotent + published-immutability-safe: if a version already covers the pilot skills, reuse it (repoint if needed);
 * otherwise create a NEW PUBLISHED version (versionNo = max+1) with a fresh 13-item pool and repoint currentVersionId.
 * v1 (the seeded 3-skill pool) is never mutated.
 */
async function ensureDiagnosticCoversPilotSkills(deps: ProvisionDeps, subjectId: string, actor: string) {
  const { prisma } = deps;
  const def = await prisma.assessmentDefinition.findFirst({ where: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, status: 'PUBLISHED' }, include: { versions: true } });
  if (!def) throw new Error('published DIAGNOSTIC definition not found — run db:seed:runtime first');

  const skills = await prisma.skill.findMany({ where: { subjectId, code: { in: A1_DIAGNOSTIC_ITEMS.map((i) => i.skillCode) } } });
  const idByCode = new Map(skills.map((s) => [s.code as string, s.id]));
  const missing = A1_DIAGNOSTIC_ITEMS.filter((i) => !idByCode.has(i.skillCode));
  if (missing.length) throw new Error(`pilot skills missing (import first): ${missing.map((m) => m.skillCode).join(', ')}`);
  const pilotSkillIds = new Set(A1_DIAGNOSTIC_ITEMS.map((i) => idByCode.get(i.skillCode)!));

  // Does ANY existing version already cover all pilot skills? (idempotency — no duplicate version/items on rerun)
  const covers = async (versionId: string) => {
    const rows = await prisma.assessmentVersionItem.findMany({ where: { versionId }, include: { item: { select: { skillId: true } } } });
    const present = new Set(rows.map((r) => r.item.skillId));
    return [...pilotSkillIds].every((s) => present.has(s));
  };
  for (const v of def.versions) {
    if (await covers(v.id)) {
      if (def.currentVersionId !== v.id) await prisma.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: v.id } });
      const poolSize = await prisma.assessmentVersionItem.count({ where: { versionId: v.id } });
      return { versionNo: v.versionNo, poolSize, distinctSkills: pilotSkillIds.size, createdNewVersion: false };
    }
  }

  // Create a NEW published version (config cloned from current, coverage tuned to measure all pilot skills).
  const base = def.versions.find((v) => v.id === def.currentVersionId) ?? def.versions[0];
  const newConfig = { ...(base.config as object), coverage: { itemsPerSkill: 1 }, stopping: { maxItems: A1_DIAGNOSTIC_ITEMS.length } };
  const nextNo = Math.max(0, ...def.versions.map((v) => v.versionNo)) + 1;

  const result = await prisma.$transaction(async (tx) => {
    const version = await tx.assessmentDefinitionVersion.create({
      data: { definitionId: def.id, versionNo: nextNo, config: newConfig, status: RevisionStatus.PUBLISHED, createdBy: actor, publishedAt: new Date() },
    });
    for (const it of A1_DIAGNOSTIC_ITEMS) {
      const item = await tx.assessmentItem.create({
        data: { definitionId: def.id, type: ActivityType.MINI_QUESTION, payload: it.payload, skillId: idByCode.get(it.skillCode)!, difficulty: it.difficulty, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN },
      });
      await tx.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } });
    }
    await tx.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: version.id } });
    return { versionNo: version.versionNo, poolSize: A1_DIAGNOSTIC_ITEMS.length };
  });
  return { versionNo: result.versionNo, poolSize: result.poolSize, distinctSkills: pilotSkillIds.size, createdNewVersion: true };
}
