import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ActivityType,
  BlueprintBindingRole,
  ContainerStatus,
  RevisionStatus,
  SkillContributionRole,
  SkillStatus,
} from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { getActivityDefinition } from '../content/activity/activity-registry';

/**
 * DEV/TEST V2 English-A1 roadmap provisioner — authors the FULL canonical A1 RoadmapPoint graph (5 points +
 * linear prerequisites) on top of the existing 13-skill / 12-lesson A1 pilot content. NON-production, OPT-IN
 * (ALLOW_DEV_FIXTURE=true), idempotent. It never invents lessons: each point orchestrates the existing lessons
 * for its skills via TeachingBlueprint bindings (RoadmapPoint != Lesson). Superset of provision-v2-present-simple.
 *
 * It also provisions the subject domain set (Grammar, Vocabulary, Reading, Listening, Writing, Speaking,
 * Pronunciation) and tags each A1 skill's primary domain — so a placement result can present per-domain bands
 * where evidence exists and "not assessed" where it does not.
 */
export const A1_SUBJECT_SLUG = 'english-a1-dev';
export const A1_LEVEL_CODE = 'A1';
export const A1_MASTERY_POLICY_VERSION = 'v2-a1-mastery-v1';
export const A1_MASTERY_THRESHOLD_BP = 8000;
export const A1_MASTERY_MIN_INDEPENDENCE = 1;

/** Subject domains for English (§17 capability matrix). Grammar/Vocabulary are objectively assessed at A1. */
export const A1_DOMAINS: { code: string; name: string; sortOrder: number }[] = [
  { code: 'GRAMMAR', name: 'Grammar', sortOrder: 1 },
  { code: 'VOCABULARY', name: 'Vocabulary', sortOrder: 2 },
  { code: 'READING', name: 'Reading', sortOrder: 3 },
  { code: 'LISTENING', name: 'Listening', sortOrder: 4 },
  { code: 'WRITING', name: 'Writing', sortOrder: 5 },
  { code: 'SPEAKING', name: 'Speaking', sortOrder: 6 },
  { code: 'PRONUNCIATION', name: 'Pronunciation', sortOrder: 7 },
];

/** Each A1 skill's single primary diagnostic domain (only GRAMMAR/VOCABULARY carry objective evidence). */
export const A1_SKILL_DOMAIN: Record<string, string> = {
  'ENG-A1-GREETINGS': 'VOCABULARY',
  'ENG-A1-SUBJECT-PRONOUNS': 'GRAMMAR',
  'ENG-A1-BE-AFFIRMATIVE': 'GRAMMAR',
  'ENG-A1-BE-NEGATIVE': 'GRAMMAR',
  'ENG-A1-BE-QUESTIONS': 'GRAMMAR',
  'ENG-A1-NUMBERS': 'VOCABULARY',
  'ENG-A1-PERSONAL-INFO': 'VOCABULARY',
  'ENG-A1-POSSESSIVE-ADJECTIVES': 'GRAMMAR',
  'ENG-A1-FAMILY-VOCAB': 'VOCABULARY',
  'ENG-A1-HAVE-HAS': 'GRAMMAR',
  'ENG-A1-PRESENT-SIMPLE-AFFIRMATIVE': 'GRAMMAR',
  'ENG-A1-PRESENT-SIMPLE-NEGATIVE': 'GRAMMAR',
  'ENG-A1-PRESENT-SIMPLE-QUESTIONS': 'GRAMMAR',
};

export interface PointSpec {
  key: string;
  title: string;
  sortOrder: number;
  skillCodes: string[];
  lessonKeys: string[];
  canDo: string[];
}

/** The A1 point graph: five pedagogical points, linear prerequisites, orchestrating the 12 pilot lessons. */
export const A1_POINT_PLAN: PointSpec[] = [
  { key: 'ENG-A1-GREETINGS-INTRO', title: 'Greetings & Pronouns', sortOrder: 10, skillCodes: ['ENG-A1-GREETINGS', 'ENG-A1-SUBJECT-PRONOUNS'], lessonKeys: ['ENG-A1-001-GREETINGS', 'ENG-A1-002-SUBJECT-PRONOUNS'], canDo: ['Salomlashish va tanishuv', 'Kishilik olmoshlarini ishlatish'] },
  { key: 'ENG-A1-VERB-BE', title: 'The verb to be', sortOrder: 20, skillCodes: ['ENG-A1-BE-AFFIRMATIVE', 'ENG-A1-BE-NEGATIVE', 'ENG-A1-BE-QUESTIONS'], lessonKeys: ['ENG-A1-003-BE-AFFIRMATIVE', 'ENG-A1-004-BE-NEGATIVE', 'ENG-A1-005-BE-QUESTIONS'], canDo: ['am/is/are tasdiq, inkor va savol shakllari'] },
  { key: 'ENG-A1-PERSONAL-INFO', title: 'Numbers & Personal info', sortOrder: 30, skillCodes: ['ENG-A1-NUMBERS', 'ENG-A1-PERSONAL-INFO'], lessonKeys: ['ENG-A1-006-NUMBERS-PERSONAL-INFO'], canDo: ['Sonlar (0–100) va shaxsiy ma’lumot'] },
  { key: 'ENG-A1-FAMILY-POSSESSION', title: 'Family & Possession', sortOrder: 40, skillCodes: ['ENG-A1-POSSESSIVE-ADJECTIVES', 'ENG-A1-FAMILY-VOCAB', 'ENG-A1-HAVE-HAS'], lessonKeys: ['ENG-A1-007-POSSESSIVE-ADJECTIVES', 'ENG-A1-008-FAMILY', 'ENG-A1-009-HAVE-HAS'], canDo: ['Egalik sifatlari, oila a’zolari, have/has'] },
  { key: 'ENG-A1-PRESENT-SIMPLE', title: 'Present Simple', sortOrder: 100, skillCodes: ['ENG-A1-PRESENT-SIMPLE-AFFIRMATIVE', 'ENG-A1-PRESENT-SIMPLE-NEGATIVE', 'ENG-A1-PRESENT-SIMPLE-QUESTIONS'], lessonKeys: ['ENG-A1-010-PRESENT-SIMPLE-AFFIRMATIVE', 'ENG-A1-011-PRESENT-SIMPLE-NEGATIVE', 'ENG-A1-012-PRESENT-SIMPLE-QUESTIONS'], canDo: ['Present simple: odat, fakt; -s; inkor va savol'] },
];

const REQUIRED_EVIDENCE_KINDS = ['controlled-production', 'free-production'];

export interface A1Env {
  nodeEnv: string | undefined;
  allowDevFixture: string | undefined;
}

export function assertA1ProvisionAllowed(env: A1Env): void {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('dev:provision:v2-english-a1-roadmap is forbidden in production');
  if ((env.allowDevFixture ?? '').trim() !== 'true') throw new Error('dev:provision:v2-english-a1-roadmap requires ALLOW_DEV_FIXTURE=true');
}

export interface A1ProvisionResult {
  subjectId: string;
  levelId: string;
  domainIds: Record<string, string>;
  pointIds: string[]; // in plan order
}

export async function provisionV2EnglishA1Roadmap(prisma: PrismaService, env: A1Env): Promise<A1ProvisionResult> {
  assertA1ProvisionAllowed(env);

  const subject = await prisma.subject.findUnique({ where: { slug: A1_SUBJECT_SLUG } });
  if (!subject) throw new Error(`subject ${A1_SUBJECT_SLUG} not found — run db:seed:runtime + dev:provision:english-a1 first`);
  const createdBy = subject.createdBy;
  const track = await prisma.track.findFirst({ where: { subjectId: subject.id } });
  if (!track) throw new Error('track not found for subject');
  const level = await prisma.level.findUnique({ where: { trackId_code: { trackId: track.id, code: A1_LEVEL_CODE } } });
  if (!level) throw new Error(`level ${A1_LEVEL_CODE} not found`);

  // 1. Domains + skill primary-domain tagging.
  const domainIds: Record<string, string> = {};
  for (const d of A1_DOMAINS) {
    const domain = await prisma.subjectDomain.upsert({
      where: { subjectId_code: { subjectId: subject.id, code: d.code } },
      create: { subjectId: subject.id, code: d.code, name: d.name, sortOrder: d.sortOrder, status: SkillStatus.ACTIVE, createdBy },
      update: { name: d.name, sortOrder: d.sortOrder },
    });
    domainIds[d.code] = domain.id;
  }

  // 2. Author each point (idempotent). Collect ids by key.
  const pointIdByKey = new Map<string, string>();
  for (const spec of A1_POINT_PLAN) {
    const pointId = await authorPoint(prisma, { subjectId: subject.id, levelId: level.id, createdBy, domainIds }, spec);
    pointIdByKey.set(spec.key, pointId);
  }

  // 3. Linear prerequisites (by plan order) on each point's published revision.
  for (let i = 1; i < A1_POINT_PLAN.length; i++) {
    const spec = A1_POINT_PLAN[i];
    const prev = A1_POINT_PLAN[i - 1];
    await ensurePrerequisite(prisma, pointIdByKey.get(spec.key)!, pointIdByKey.get(prev.key)!);
  }

  return {
    subjectId: subject.id,
    levelId: level.id,
    domainIds,
    pointIds: A1_POINT_PLAN.map((s) => pointIdByKey.get(s.key)!),
  };
}

interface AuthorCtx {
  subjectId: string;
  levelId: string;
  createdBy: string;
  domainIds: Record<string, string>;
}

async function authorPoint(prisma: PrismaService, ctx: AuthorCtx, spec: PointSpec): Promise<string> {
  // Resolve skills (required) + their published expectation revisions; tag primary domain.
  const expectationRevIds: string[] = [];
  const skillIds: string[] = [];
  for (const code of spec.skillCodes) {
    const skill = await prisma.skill.findUnique({ where: { subjectId_code: { subjectId: ctx.subjectId, code } } });
    if (!skill) throw new Error(`skill ${code} not found — run dev:provision:english-a1 first`);
    skillIds.push(skill.id);
    const domainCode = A1_SKILL_DOMAIN[code];
    const domainId = domainCode ? ctx.domainIds[domainCode] : undefined;
    if (domainId && skill.primaryDomainId !== domainId) {
      await prisma.skill.update({ where: { id: skill.id }, data: { primaryDomainId: domainId } });
    }
    expectationRevIds.push(await ensureExpectation(prisma, skill.id, ctx.levelId, ctx.createdBy));
  }

  // Resolve lessons present (bind whatever exists) + their published activities.
  const lessons: { revisionId: string; activities: { id: string; type: ActivityType }[] }[] = [];
  for (const contentKey of spec.lessonKeys) {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey }, select: { id: true, publishedRevisionId: true } });
    if (!lesson?.publishedRevisionId) continue; // bind only lessons that are actually present + published
    const activities = await prisma.activity.findMany({ where: { lessonRevisionId: lesson.publishedRevisionId }, orderBy: { position: 'asc' }, select: { id: true, type: true } });
    lessons.push({ revisionId: lesson.publishedRevisionId, activities });
  }
  if (lessons.length === 0) throw new Error(`point ${spec.key}: none of its lessons are provisioned/published`);

  const { pointId } = await ensureRoadmapPoint(prisma, ctx, spec, skillIds);
  await ensureBlueprint(prisma, pointId, ctx.createdBy, lessons);
  await ensureMasteryRequirement(prisma, pointId, ctx.createdBy, expectationRevIds);
  return pointId;
}

async function ensureExpectation(prisma: PrismaService, skillId: string, levelId: string, publishedBy: string): Promise<string> {
  const expectation = await prisma.skillLevelExpectation.upsert({ where: { skillId_levelId: { skillId, levelId } }, create: { skillId, levelId }, update: {} });
  let revision = await prisma.skillLevelExpectationRevision.findUnique({ where: { expectationId_versionNo: { expectationId: expectation.id, versionNo: 1 } } });
  if (!revision) {
    revision = await prisma.skillLevelExpectationRevision.create({
      data: { expectationId: expectation.id, versionNo: 1, status: RevisionStatus.PUBLISHED, isIntroduced: true, isExpected: true, isAssessed: true, isRequiredForExit: true, requiredEvidenceKinds: REQUIRED_EVIDENCE_KINDS, minIndependence: A1_MASTERY_MIN_INDEPENDENCE, criticality: 1, publishedBy, publishedAt: new Date() },
    });
  }
  if (expectation.currentRevisionId !== revision.id) await prisma.skillLevelExpectation.update({ where: { id: expectation.id }, data: { currentRevisionId: revision.id } });
  return revision.id;
}

async function ensureRoadmapPoint(prisma: PrismaService, ctx: AuthorCtx, spec: PointSpec, skillIds: string[]): Promise<{ pointId: string; pointRevisionId: string }> {
  const existing = await prisma.roadmapPoint.findUnique({ where: { pointKey: spec.key } });
  const point = existing ?? (await prisma.roadmapPoint.create({ data: { pointKey: spec.key, levelId: ctx.levelId, status: ContainerStatus.DRAFT, createdBy: ctx.createdBy } }));
  let revision = await prisma.roadmapPointRevision.findUnique({ where: { roadmapPointId_versionNo: { roadmapPointId: point.id, versionNo: 1 } } });
  if (!revision) {
    revision = await prisma.roadmapPointRevision.create({
      data: { roadmapPointId: point.id, versionNo: 1, status: RevisionStatus.PUBLISHED, title: spec.title, learningOutcome: { canDo: spec.canDo }, sortOrderDefault: spec.sortOrder, requiredFlag: true, estimatedEffortMin: 20, publishedBy: ctx.createdBy, publishedAt: new Date() },
    });
  }
  for (const skillId of skillIds) {
    const expectation = await prisma.skillLevelExpectation.findUnique({ where: { skillId_levelId: { skillId, levelId: ctx.levelId } } });
    if (!expectation) continue;
    await prisma.roadmapPointSkillExpectation.upsert({
      where: { roadmapPointRevisionId_skillLevelExpectationId: { roadmapPointRevisionId: revision.id, skillLevelExpectationId: expectation.id } },
      create: { roadmapPointRevisionId: revision.id, skillLevelExpectationId: expectation.id, role: SkillContributionRole.REQUIRED },
      update: {},
    });
  }
  if (point.publishedRevisionId !== revision.id || point.status !== ContainerStatus.PUBLISHED) {
    await prisma.roadmapPoint.update({ where: { id: point.id }, data: { publishedRevisionId: revision.id, status: ContainerStatus.PUBLISHED } });
  }
  return { pointId: point.id, pointRevisionId: revision.id };
}

/** 4 role-grouped stages (concept/recognition/practice/mastery) pulling activities across the point's lessons. */
async function ensureBlueprint(prisma: PrismaService, roadmapPointId: string, createdBy: string, lessons: { activities: { id: string; type: ActivityType }[] }[]): Promise<void> {
  const roleOf = (type: ActivityType): 'teach' | 'recognition' | 'production' | 'mastery' | 'skip' => {
    if (type === ActivityType.MASTERY_TEST) return 'mastery';
    if (type === ActivityType.MINI_QUESTION) return 'recognition';
    if (type === ActivityType.PRACTICE) return 'production';
    return getActivityDefinition(type).executionKind === 'VIEW_ONLY' ? 'teach' : 'skip';
  };
  const collect = (role: 'teach' | 'recognition' | 'production' | 'mastery') => lessons.flatMap((l) => l.activities.filter((a) => roleOf(a.type) === role).map((a) => a.id));
  const stagePlan = [
    { stageKey: 'concept', stageType: 'concept', title: 'Tushuncha', description: 'Qoida va misollarni o‘rganing.', role: BlueprintBindingRole.TEACH, activityIds: collect('teach') },
    { stageKey: 'recognition', stageType: 'recognition', title: 'Tanib olish', description: 'To‘g‘ri shaklni taning.', role: BlueprintBindingRole.PRACTICE, activityIds: collect('recognition') },
    { stageKey: 'practice', stageType: 'production', title: 'Mashq', description: 'Mustaqil gap tuzing.', role: BlueprintBindingRole.PRACTICE, activityIds: collect('production') },
    { stageKey: 'mastery', stageType: 'mastery', title: 'Yakuniy tekshiruv', description: 'Bilimingizni tekshiring.', role: BlueprintBindingRole.EVIDENCE, activityIds: collect('mastery') },
  ].filter((s) => s.stageType === 'mastery' || s.activityIds.length > 0);
  const mastery = stagePlan.find((s) => s.stageType === 'mastery');
  if (!mastery || mastery.activityIds.length === 0) throw new Error(`blueprint for point ${roadmapPointId}: no MASTERY_TEST activities in the point's lessons`);

  const existing = await prisma.teachingBlueprint.findUnique({ where: { roadmapPointId } });
  const blueprint = existing ?? (await prisma.teachingBlueprint.create({ data: { roadmapPointId, status: ContainerStatus.DRAFT, createdBy } }));
  let revision = await prisma.teachingBlueprintRevision.findUnique({ where: { blueprintId_versionNo: { blueprintId: blueprint.id, versionNo: 1 } } });
  if (!revision) revision = await prisma.teachingBlueprintRevision.create({ data: { blueprintId: blueprint.id, versionNo: 1, status: RevisionStatus.PUBLISHED, estimatedDurationMin: 20, publishedBy: createdBy, publishedAt: new Date() } });

  if ((await prisma.teachingBlueprintStage.count({ where: { blueprintRevisionId: revision.id } })) === 0) {
    await prisma.$transaction(async (tx) => {
      let position = 1;
      for (const stage of stagePlan) {
        const stageRow = await tx.teachingBlueprintStage.create({ data: { blueprintRevisionId: revision!.id, stageKey: stage.stageKey, position, stageType: stage.stageType, config: { title: stage.title, description: stage.description } } });
        let bpos = 1;
        for (const activityId of stage.activityIds) {
          await tx.teachingBlueprintContentBinding.create({ data: { blueprintStageId: stageRow.id, activityId, role: stage.role, position: bpos } });
          bpos++;
        }
        position++;
      }
    });
  }
  if (blueprint.publishedRevisionId !== revision.id || blueprint.status !== ContainerStatus.PUBLISHED) {
    await prisma.teachingBlueprint.update({ where: { id: blueprint.id }, data: { publishedRevisionId: revision.id, status: ContainerStatus.PUBLISHED } });
  }
}

async function ensureMasteryRequirement(prisma: PrismaService, roadmapPointId: string, createdBy: string, expectationRevisionIds: string[]): Promise<void> {
  const existing = await prisma.masteryRequirement.findUnique({ where: { roadmapPointId } });
  const requirement = existing ?? (await prisma.masteryRequirement.create({ data: { roadmapPointId, status: ContainerStatus.DRAFT, createdBy } }));
  let revision = await prisma.masteryRequirementRevision.findUnique({ where: { requirementId_versionNo: { requirementId: requirement.id, versionNo: 1 } } });
  if (!revision) revision = await prisma.masteryRequirementRevision.create({ data: { requirementId: requirement.id, versionNo: 1, status: RevisionStatus.PUBLISHED, gates: { thresholdBp: A1_MASTERY_THRESHOLD_BP, minIndependence: A1_MASTERY_MIN_INDEPENDENCE, requireAllRequiredSkills: true }, policyVersion: A1_MASTERY_POLICY_VERSION, publishedBy: createdBy, publishedAt: new Date() } });
  for (const expectationRevisionId of expectationRevisionIds) {
    await prisma.masteryRequirementSkillExpectation.upsert({
      where: { requirementRevisionId_skillLevelExpectationRevisionId: { requirementRevisionId: revision.id, skillLevelExpectationRevisionId: expectationRevisionId } },
      create: { requirementRevisionId: revision.id, skillLevelExpectationRevisionId: expectationRevisionId, role: SkillContributionRole.REQUIRED, requiredEvidenceKinds: REQUIRED_EVIDENCE_KINDS, minIndependence: A1_MASTERY_MIN_INDEPENDENCE },
      update: {},
    });
  }
  if (requirement.currentRevisionId !== revision.id || requirement.status !== ContainerStatus.PUBLISHED) {
    await prisma.masteryRequirement.update({ where: { id: requirement.id }, data: { currentRevisionId: revision.id, status: ContainerStatus.PUBLISHED } });
  }
}

/** Idempotent prerequisite edge on the point's published revision (denormalized owner for the self-loop CHECK). */
async function ensurePrerequisite(prisma: PrismaService, pointId: string, prerequisitePointId: string): Promise<void> {
  const point = await prisma.roadmapPoint.findUnique({ where: { id: pointId }, select: { publishedRevisionId: true } });
  if (!point?.publishedRevisionId) return;
  await prisma.roadmapPointPrerequisite.upsert({
    where: { roadmapPointRevisionId_prerequisitePointId: { roadmapPointRevisionId: point.publishedRevisionId, prerequisitePointId } },
    create: { roadmapPointRevisionId: point.publishedRevisionId, roadmapPointId: pointId, prerequisitePointId },
    update: {},
  });
}

async function main(): Promise<void> {
  const logger = new Logger('ProvisionV2EnglishA1Roadmap');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await provisionV2EnglishA1Roadmap(app.get(PrismaService), { nodeEnv: process.env.NODE_ENV, allowDevFixture: process.env.ALLOW_DEV_FIXTURE });
    logger.log(`V2 A1 roadmap ready — subject=${result.subjectId} points=${result.pointIds.length} domains=${Object.keys(result.domainIds).length}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('ProvisionV2EnglishA1Roadmap').error(`V2 A1 roadmap provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
