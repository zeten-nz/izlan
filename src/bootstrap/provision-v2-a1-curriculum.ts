/**
 * DEV-ONLY provisioning: author the English A1 FOUNDATION EXPANSION on top of the existing pilot + roadmap, entirely
 * through the REAL content workflow — NOT raw Prisma inserts of published rows.
 *
 * For each new grammar concept it: (1) imports the authored lesson package via the canonical importer (validate →
 * apply DRAFT); (2) publishes the topic + lesson via the real publication service; (3) authors a RoadmapPoint through
 * the PointAuthoringService lifecycle — create bundle → set required skill → set prerequisites → author a
 * multi-stage TeachingBlueprint that binds the PUBLISHED activities → author an honest MasteryRequirement → submit for
 * review → APPROVED ContentReview → publish. Every point therefore passes the same Content Quality gate as staff-
 * authored content (readiness blockers + an approved review). No "insert published curriculum" shortcut exists here.
 *
 * Fail-closed: forbidden in production, requires ALLOW_DEV_FIXTURE=true. Idempotent on the A1 natural keys. It assumes
 * the pilot (12 lessons) and the base roadmap (VERB-BE, PRESENT-SIMPLE, …) are already provisioned — those points are
 * the prerequisites the new points build upon.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlueprintBindingRole, ContentReviewOutcome, SkillContributionRole, SkillStatus } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { ImportService } from '../content-import/import.service';
import type { SubjectService } from '../content-authoring/subject.service';
import type { HierarchyService } from '../content-authoring/hierarchy.service';
import type { HierarchyPublishService } from '../content-authoring/publish/hierarchy-publish.service';
import type { PublicationService } from '../content-authoring/publish/publication.service';
import type { PointAuthoringService } from '../point-authoring/point-authoring.service';
import { RUNTIME_SUBJECT, RUNTIME_TRACK } from './seed-runtime';
import { DEMO_ADMIN } from './seed-demo';
import { PILOT_DIR } from '../content-import/pilot/english-a1-pilot';
import {
  CURRICULUM_IMPORT_FILES, CURRICULUM_TOPICS, CURRICULUM_POINT_PLAN, CURRICULUM_DOMAIN_CODE, CURRICULUM_SKILL_CODES,
  CURRICULUM_EVIDENCE_KINDS, CURRICULUM_MASTERY_THRESHOLD_BP, CURRICULUM_MASTERY_MIN_INDEPENDENCE,
  type CurriculumPointSpec,
} from '../content-import/pilot/english-a1-curriculum';

export interface CurriculumEnv {
  nodeEnv: string | undefined;
  allowDevFixture: string | undefined;
}
export function assertCurriculumProvisionAllowed(env: CurriculumEnv): void {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('dev:provision:v2-a1-curriculum is forbidden in production');
  if ((env.allowDevFixture ?? '').trim() !== 'true') throw new Error('dev:provision:v2-a1-curriculum requires ALLOW_DEV_FIXTURE=true');
}

export interface CurriculumDeps {
  prisma: PrismaService;
  subjects: SubjectService;
  hierarchy: HierarchyService;
  importer: ImportService;
  hierarchyPublish: HierarchyPublishService;
  publication: PublicationService;
  points: PointAuthoringService;
}

export interface CurriculumProvisionResult {
  subjectId: string;
  topicsCreated: number;
  lessonsPublished: number;
  skillsMappedToDomain: number;
  pointsPublished: number;
  pointKeys: string[];
}

const iso = (d: Date) => d.toISOString();

export async function provisionA1Curriculum(deps: CurriculumDeps, env: CurriculumEnv): Promise<CurriculumProvisionResult> {
  assertCurriculumProvisionAllowed(env);
  const { prisma } = deps;

  // 0) Locate subject/level/module + ADMIN actor (fail with guidance if the foundation isn't provisioned).
  const subject = await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } });
  if (!subject) throw new Error(`subject ${RUNTIME_SUBJECT.slug} not found — run db:seed:runtime + dev:provision:english-a1 first`);
  const track = await prisma.track.findFirst({ where: { subjectId: subject.id, slug: RUNTIME_TRACK.slug } });
  const level = track && (await prisma.level.findFirst({ where: { trackId: track.id } }));
  const moduleRow = level && (await prisma.module.findFirst({ where: { levelId: level.id } }));
  if (!level || !moduleRow) throw new Error('A1 level/module not found — run the foundation provisioners first');
  const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone } });
  if (!admin) throw new Error(`admin ${DEMO_ADMIN.phone} not found — run db:seed:runtime first`);
  const actor = admin.id;

  // The base roadmap points this expansion depends on must already be published.
  for (const spec of CURRICULUM_POINT_PLAN) {
    for (const pre of spec.prerequisitePointKeys) {
      if (CURRICULUM_POINT_PLAN.some((p) => p.pointKey === pre)) continue; // an earlier curriculum point (published in this run)
      const exists = await prisma.roadmapPoint.findUnique({ where: { pointKey: pre }, select: { status: true } });
      if (!exists || exists.status !== 'PUBLISHED') throw new Error(`prerequisite point ${pre} is not published — run dev:provision:v2-english-a1-roadmap first`);
    }
  }

  // 1) Author scope (idempotent).
  await deps.subjects.assignUser(actor, subject.id, actor);

  // 2) New Topics (idempotent by title within the module).
  const topicIdByFile = new Map<string, string>();
  let topicsCreated = 0;
  for (const t of CURRICULUM_TOPICS) {
    const existing = await prisma.topic.findFirst({ where: { moduleId: moduleRow.id, title: t.title } });
    const id = existing ? existing.id : (topicsCreated++, (await deps.hierarchy.createTopic(actor, moduleRow.id, { title: t.title, description: t.description, sortOrder: t.order })).id);
    topicIdByFile.set(t.importFile, id);
  }

  // 3) Import each package (validate → apply DRAFT). Skip a file already imported (idempotent by first contentKey).
  for (const file of CURRICULUM_IMPORT_FILES) {
    const doc = JSON.parse(readFileSync(resolve(PILOT_DIR, file), 'utf8')) as { lessons: { contentKey: string }[] };
    if (await prisma.lesson.findUnique({ where: { contentKey: doc.lessons[0].contentKey } })) continue;
    const validated = await deps.importer.validate(actor, topicIdByFile.get(file)!, doc);
    if (!(validated as { valid: boolean }).valid) throw new Error(`import validate failed for ${file}: ${JSON.stringify((validated as { errors?: unknown }).errors)}`);
    await deps.importer.apply(actor, topicIdByFile.get(file)!, doc);
  }

  // 4) Publish the new Topics (ancestors already PUBLISHED from the foundation). Idempotent.
  for (const t of CURRICULUM_TOPICS) {
    const topic = await prisma.topic.findUnique({ where: { id: topicIdByFile.get(t.importFile)! } });
    if (topic!.status !== 'PUBLISHED') await deps.hierarchyPublish.publishTopic(actor, topic!.id, { expectedUpdatedAt: iso(topic!.updatedAt) });
  }

  // 5) Publish each new lesson (submit-review → publish). Idempotent (skip already PUBLISHED).
  let lessonsPublished = 0;
  for (const spec of CURRICULUM_POINT_PLAN) {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey: spec.lessonContentKey }, include: { revisions: true } });
    if (!lesson) throw new Error(`lesson ${spec.lessonContentKey} not found after import`);
    if (lesson.status === 'PUBLISHED') { lessonsPublished++; continue; }
    const rev = lesson.revisions.find((r) => r.version === 1) ?? lesson.revisions[0];
    if (rev.status === 'DRAFT') await deps.publication.submitReview(actor, rev.id, { expectedUpdatedAt: iso(rev.updatedAt) });
    const revFresh = await prisma.lessonRevision.findUniqueOrThrow({ where: { id: rev.id } });
    const lessonFresh = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    await deps.publication.publish(actor, rev.id, { expectedRevisionUpdatedAt: iso(revFresh.updatedAt), expectedLessonUpdatedAt: iso(lessonFresh.updatedAt) });
    lessonsPublished++;
  }

  // 6) Map the new skills to the GRAMMAR domain (honest primary-domain evidence; NOT_ASSESSED domains stay empty).
  const grammarDomain = await prisma.subjectDomain.findUnique({ where: { subjectId_code: { subjectId: subject.id, code: CURRICULUM_DOMAIN_CODE } } });
  let skillsMappedToDomain = 0;
  if (grammarDomain) {
    for (const code of CURRICULUM_SKILL_CODES) {
      const skill = await prisma.skill.findUnique({ where: { subjectId_code: { subjectId: subject.id, code } }, select: { id: true, primaryDomainId: true } });
      if (skill && skill.primaryDomainId !== grammarDomain.id) {
        await prisma.skill.update({ where: { id: skill.id }, data: { primaryDomainId: grammarDomain.id } });
        skillsMappedToDomain++;
      }
    }
  }

  // 7) Author each RoadmapPoint through the real point-authoring workflow (draft → review → publish).
  const pointKeys: string[] = [];
  let pointsPublished = 0;
  for (const spec of CURRICULUM_POINT_PLAN) {
    const existing = await prisma.roadmapPoint.findUnique({ where: { pointKey: spec.pointKey }, select: { id: true, status: true } });
    if (existing?.status === 'PUBLISHED') { pointsPublished++; pointKeys.push(spec.pointKey); continue; }
    await authorAndPublishPoint(deps, actor, level.id, subject.id, spec);
    pointsPublished++;
    pointKeys.push(spec.pointKey);
  }

  return { subjectId: subject.id, topicsCreated, lessonsPublished, skillsMappedToDomain, pointsPublished, pointKeys };
}

/** Drive one point end-to-end through PointAuthoringService (the same path the staff Content Studio uses over HTTP). */
async function authorAndPublishPoint(deps: CurriculumDeps, actor: string, levelId: string, subjectId: string, spec: CurriculumPointSpec): Promise<void> {
  const { prisma, points } = deps;

  // Resolve the point's required skill + its published lesson activities (for blueprint bindings + mastery evidence).
  const skill = await prisma.skill.findUniqueOrThrow({ where: { subjectId_code: { subjectId, code: spec.skillCode } }, select: { id: true } });
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { contentKey: spec.lessonContentKey }, select: { publishedRevisionId: true } });
  if (!lesson.publishedRevisionId) throw new Error(`lesson ${spec.lessonContentKey} is not published`);
  const activities = await prisma.activity.findMany({ where: { lessonRevisionId: lesson.publishedRevisionId }, orderBy: { position: 'asc' }, select: { id: true, type: true, position: true } });
  const stages = buildBlueprintStages(activities);
  const prerequisitePointIds = await resolvePrerequisiteIds(prisma, spec);

  // create bundle (title/canDo/sortOrder/effort set here) → detail carries the DRAFT revision ids + OCC tokens.
  let detail = await points.createPoint(actor, levelId, { pointKey: spec.pointKey, title: spec.title, canDo: spec.canDo, sortOrderDefault: spec.sortOrder, estimatedEffortMin: spec.estimatedEffortMin });
  detail = await points.setPointSkills(actor, detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt, skills: [{ skillId: skill.id, role: SkillContributionRole.REQUIRED }] });
  if (prerequisitePointIds.length > 0) {
    detail = await points.setPointPrerequisites(actor, detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt, prerequisitePointIds });
  }
  detail = await points.setBlueprintStages(actor, detail.blueprint!.revision!.id, { expectedUpdatedAt: detail.blueprint!.revision!.updatedAt, stages });
  // A point may override the gate to genuinely require structured production (controlled-production @ independence 2).
  const evidenceKinds = spec.masteryEvidenceKinds ?? CURRICULUM_EVIDENCE_KINDS;
  const minIndependence = spec.masteryMinIndependence ?? CURRICULUM_MASTERY_MIN_INDEPENDENCE;
  detail = await points.setMastery(actor, detail.mastery!.revision!.id, {
    expectedUpdatedAt: detail.mastery!.revision!.updatedAt,
    gates: { thresholdBp: CURRICULUM_MASTERY_THRESHOLD_BP, minIndependence, requireAllRequiredSkills: true },
    skillGates: [{ skillId: skill.id, role: SkillContributionRole.REQUIRED, requiredEvidenceKinds: [...evidenceKinds], minIndependence }],
  });
  // submit → review(APPROVED) → publish. requireFourEyes=false → the same principal may self-review.
  detail = await points.submitReview(actor, detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt });
  detail = await points.reviewPoint(actor, detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt, outcome: ContentReviewOutcome.APPROVED, notes: 'A1 curriculum expansion — Methodist review.' });
  await points.publishPoint(actor, detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt });
}

interface StageActivity { id: string; type: string; position: number }
interface StageInput { stageKey: string; stageType: string; title: string; description?: string; bindings: { activityId: string; role: BlueprintBindingRole }[] }

const OBJECTIVE = new Set(['MINI_QUESTION', 'PRACTICE', 'MASTERY_TEST']);
const VIEW = new Set(['TEXT', 'EXPLANATION', 'EXAMPLE']);

/**
 * A pedagogically-ordered blueprint over a lesson's published activities: concept (leading teaching) → recognition
 * (the early check) → production (the mistake contrast + guided practice) → mastery (the evidence + wrap-up). Empty
 * stages are dropped; mastery always carries the MASTERY_TEST activities as EVIDENCE (so the gate is satisfiable).
 */
export function buildBlueprintStages(activities: StageActivity[]): StageInput[] {
  const firstObjective = activities.findIndex((a) => OBJECTIVE.has(a.type));
  const firstMastery = activities.findIndex((a) => a.type === 'MASTERY_TEST');
  const concept: StageInput['bindings'] = [];
  const recognition: StageInput['bindings'] = [];
  const production: StageInput['bindings'] = [];
  const mastery: StageInput['bindings'] = [];

  activities.forEach((a, i) => {
    if (a.type === 'MASTERY_TEST') { mastery.push({ activityId: a.id, role: BlueprintBindingRole.EVIDENCE }); return; }
    if (a.type === 'MINI_QUESTION') { recognition.push({ activityId: a.id, role: BlueprintBindingRole.PRACTICE }); return; }
    if (a.type === 'PRACTICE') { production.push({ activityId: a.id, role: BlueprintBindingRole.PRACTICE }); return; }
    if (VIEW.has(a.type)) {
      if (firstObjective === -1 || i < firstObjective) concept.push({ activityId: a.id, role: BlueprintBindingRole.TEACH });
      else if (firstMastery !== -1 && i > firstMastery) mastery.push({ activityId: a.id, role: BlueprintBindingRole.EXPOSURE }); // trailing summary
      else production.push({ activityId: a.id, role: BlueprintBindingRole.TEACH }); // mid-lesson mistake contrast
    }
  });

  const stages: StageInput[] = [
    { stageKey: 'concept', stageType: 'concept', title: 'Tushuncha', description: 'Nima va nega — qoida va misollar.', bindings: concept },
    { stageKey: 'recognition', stageType: 'recognition', title: 'Tanib olish', description: 'Erta tekshiruv.', bindings: recognition },
    { stageKey: 'production', stageType: 'production', title: 'Mashq', description: 'Xatolarni ko‘rib, mustaqil qo‘llash.', bindings: production },
    { stageKey: 'mastery', stageType: 'mastery', title: 'Yakuniy tekshiruv', description: 'O‘zlashtirish dalili.', bindings: mastery },
  ];
  return stages.filter((s) => s.bindings.length > 0);
}

async function resolvePrerequisiteIds(prisma: PrismaService, spec: CurriculumPointSpec): Promise<string[]> {
  const ids: string[] = [];
  for (const key of spec.prerequisitePointKeys) {
    const p = await prisma.roadmapPoint.findUnique({ where: { pointKey: key }, select: { id: true } });
    if (!p) throw new Error(`prerequisite point ${key} not found for ${spec.pointKey}`);
    ids.push(p.id);
  }
  return ids;
}
