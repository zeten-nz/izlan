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
 * DEV/TEST V2 pilot provisioner — the canonical "Present Simple" V2 RoadmapPoint (Wave B).
 * `npm run dev:provision:v2-present-simple`. NON-production, OPT-IN (ALLOW_DEV_FIXTURE=true), idempotent.
 *
 * It authors ONLY the canonical V2 layer and BINDS to the EXISTING canonical A1 pilot content
 * (lessons 010/011/012 + the three Present Simple skills). It never invents replacement lessons and
 * never duplicates the 12-lesson A1 content. RoadmapPoint != Lesson: the point orchestrates the three
 * lessons through TeachingBlueprint bindings, re-sequenced by pedagogical role (concept → recognition →
 * affirmative → negatives → questions → mastery). Requires the A1 pilot to be provisioned first.
 */

export const V2_SUBJECT_SLUG = 'english-a1-dev';
export const V2_LEVEL_CODE = 'A1';
export const V2_POINT_KEY = 'ENG-A1-PRESENT-SIMPLE';
export const V2_DOMAIN_CODE = 'GRAMMAR';
export const V2_MASTERY_POLICY_VERSION = 'v2-present-simple-mastery-v1';
export const V2_BLUEPRINT_ENGINE_VERSION = 'v2-teaching-blueprint-v1';
export const V2_MASTERY_THRESHOLD_BP = 8000;
export const V2_MASTERY_MIN_INDEPENDENCE = 1;

/** The three Present Simple skills (subject-scoped codes) this point requires. */
export const V2_PRESENT_SIMPLE_SKILL_CODES = [
  'ENG-A1-PRESENT-SIMPLE-AFFIRMATIVE',
  'ENG-A1-PRESENT-SIMPLE-NEGATIVE',
  'ENG-A1-PRESENT-SIMPLE-QUESTIONS',
] as const;

/** The three existing canonical lessons this point orchestrates (by globally-unique contentKey). */
export const V2_PRESENT_SIMPLE_LESSON_KEYS = [
  'ENG-A1-010-PRESENT-SIMPLE-AFFIRMATIVE',
  'ENG-A1-011-PRESENT-SIMPLE-NEGATIVE',
  'ENG-A1-012-PRESENT-SIMPLE-QUESTIONS',
] as const;

const REQUIRED_EVIDENCE_KINDS = ['controlled-production', 'free-production'];

export interface V2ProvisionEnv {
  nodeEnv: string | undefined;
  allowDevFixture: string | undefined;
}

/** Fail closed: forbidden in production, requires ALLOW_DEV_FIXTURE=true (no passwords — reuses existing author). */
export function assertV2ProvisionAllowed(env: V2ProvisionEnv): void {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('dev:provision:v2-present-simple is forbidden in production');
  if ((env.allowDevFixture ?? '').trim() !== 'true') throw new Error('dev:provision:v2-present-simple requires ALLOW_DEV_FIXTURE=true');
}

export interface V2ProvisionResult {
  subjectId: string;
  levelId: string;
  domainId: string;
  roadmapPointId: string;
  roadmapPointRevisionId: string;
  blueprintId: string;
  blueprintRevisionId: string;
  masteryRequirementId: string;
  masteryRequirementRevisionId: string;
  skillIds: string[];
  expectationRevisionIds: string[];
  stageCount: number;
  bindingCount: number;
}

interface StagePlan {
  stageKey: string;
  stageType: string;
  title: string;
  description: string;
  /** activityIds bound to this stage, in order, with a role. */
  bindings: { activityId: string; role: BlueprintBindingRole }[];
}

/**
 * Idempotent provisioning. Safe to rerun: every canonical row is find-or-created by a natural key and
 * stage/binding sets are seeded only when empty (atomic).
 */
export async function provisionV2PresentSimple(prisma: PrismaService, env: V2ProvisionEnv): Promise<V2ProvisionResult> {
  assertV2ProvisionAllowed(env);

  // ── 1. Resolve existing canonical anchors (subject, author, level, skills, lessons+activities). ──
  const subject = await prisma.subject.findUnique({ where: { slug: V2_SUBJECT_SLUG } });
  if (!subject) throw new Error(`subject ${V2_SUBJECT_SLUG} not found — run db:seed:runtime + dev:provision:english-a1 first`);
  const createdBy = subject.createdBy; // reuse the subject's existing content author

  const track = await prisma.track.findFirst({ where: { subjectId: subject.id } });
  if (!track) throw new Error('track not found for subject');
  const level = await prisma.level.findUnique({ where: { trackId_code: { trackId: track.id, code: V2_LEVEL_CODE } } });
  if (!level) throw new Error(`level ${V2_LEVEL_CODE} not found`);

  const skills = [];
  for (const code of V2_PRESENT_SIMPLE_SKILL_CODES) {
    const skill = await prisma.skill.findUnique({ where: { subjectId_code: { subjectId: subject.id, code } } });
    if (!skill) throw new Error(`skill ${code} not found — run dev:provision:english-a1 first (Present Simple content missing)`);
    skills.push(skill);
  }

  const lessons = [];
  for (const contentKey of V2_PRESENT_SIMPLE_LESSON_KEYS) {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey }, select: { id: true, publishedRevisionId: true } });
    if (!lesson || !lesson.publishedRevisionId) throw new Error(`lesson ${contentKey} not found or not published — run dev:provision:english-a1 first`);
    const activities = await prisma.activity.findMany({
      where: { lessonRevisionId: lesson.publishedRevisionId },
      orderBy: { position: 'asc' },
      select: { id: true, type: true, position: true },
    });
    lessons.push({ contentKey, revisionId: lesson.publishedRevisionId, activities });
  }

  // ── 2. Grammar domain (idempotent) + tag the Present Simple skills' primary domain. ──
  const domain = await ensureDomain(prisma, subject.id, createdBy);
  for (const skill of skills) {
    if (skill.primaryDomainId !== domain.id) {
      await prisma.skill.update({ where: { id: skill.id }, data: { primaryDomainId: domain.id } });
    }
  }

  // ── 3. SkillLevelExpectation (+published v1 revision) for each Present Simple skill @ A1. ──
  const expectationRevisionIds: string[] = [];
  for (const skill of skills) {
    const revId = await ensureExpectation(prisma, skill.id, level.id, createdBy);
    expectationRevisionIds.push(revId);
  }
  const expectationBySkill = new Map(skills.map((s, i) => [s.id, expectationRevisionIds[i]]));

  // ── 4. RoadmapPoint (+published v1 revision) + skill-expectation membership. ──
  const { pointId, pointRevisionId } = await ensureRoadmapPoint(prisma, level.id, createdBy, skills.map((s) => s.id));

  // ── 5. TeachingBlueprint (+published v1 revision) + ordered stages + bindings to existing activities. ──
  const stagePlan = buildStagePlan(lessons);
  const { blueprintId, blueprintRevisionId, stageCount, bindingCount } = await ensureBlueprint(prisma, pointId, createdBy, stagePlan);

  // ── 6. MasteryRequirement (+published v1 revision) + gates referencing the exact expectation revisions. ──
  const { requirementId, requirementRevisionId } = await ensureMasteryRequirement(prisma, pointId, createdBy, expectationRevisionIds);
  void expectationBySkill;

  return {
    subjectId: subject.id,
    levelId: level.id,
    domainId: domain.id,
    roadmapPointId: pointId,
    roadmapPointRevisionId: pointRevisionId,
    blueprintId,
    blueprintRevisionId,
    masteryRequirementId: requirementId,
    masteryRequirementRevisionId: requirementRevisionId,
    skillIds: skills.map((s) => s.id),
    expectationRevisionIds,
    stageCount,
    bindingCount,
  };
}

async function ensureDomain(prisma: PrismaService, subjectId: string, createdBy: string) {
  return prisma.subjectDomain.upsert({
    where: { subjectId_code: { subjectId, code: V2_DOMAIN_CODE } },
    create: { subjectId, code: V2_DOMAIN_CODE, name: 'Grammar', sortOrder: 1, status: SkillStatus.ACTIVE, createdBy },
    update: { name: 'Grammar' },
  });
}

/** Expectation identity (idempotent by skillId_levelId) + published v1 revision + currentRevision pointer. */
async function ensureExpectation(prisma: PrismaService, skillId: string, levelId: string, publishedBy: string): Promise<string> {
  const expectation = await prisma.skillLevelExpectation.upsert({
    where: { skillId_levelId: { skillId, levelId } },
    create: { skillId, levelId },
    update: {},
  });
  let revision = await prisma.skillLevelExpectationRevision.findUnique({
    where: { expectationId_versionNo: { expectationId: expectation.id, versionNo: 1 } },
  });
  if (!revision) {
    revision = await prisma.skillLevelExpectationRevision.create({
      data: {
        expectationId: expectation.id,
        versionNo: 1,
        status: RevisionStatus.PUBLISHED,
        isIntroduced: true,
        isExpected: true,
        isReinforced: false,
        isAssessed: true,
        isRequiredForExit: true,
        requiredEvidenceKinds: REQUIRED_EVIDENCE_KINDS,
        minIndependence: V2_MASTERY_MIN_INDEPENDENCE,
        criticality: 1,
        publishedBy,
        publishedAt: new Date(),
      },
    });
  }
  if (expectation.currentRevisionId !== revision.id) {
    await prisma.skillLevelExpectation.update({ where: { id: expectation.id }, data: { currentRevisionId: revision.id } });
  }
  return revision.id;
}

async function ensureRoadmapPoint(prisma: PrismaService, levelId: string, createdBy: string, skillIds: string[]): Promise<{ pointId: string; pointRevisionId: string }> {
  const existing = await prisma.roadmapPoint.findUnique({ where: { pointKey: V2_POINT_KEY } });
  const point = existing ?? (await prisma.roadmapPoint.create({
    data: { pointKey: V2_POINT_KEY, levelId, status: ContainerStatus.DRAFT, createdBy },
  }));

  let revision = await prisma.roadmapPointRevision.findUnique({
    where: { roadmapPointId_versionNo: { roadmapPointId: point.id, versionNo: 1 } },
  });
  if (!revision) {
    revision = await prisma.roadmapPointRevision.create({
      data: {
        roadmapPointId: point.id,
        versionNo: 1,
        status: RevisionStatus.PUBLISHED,
        title: 'Present Simple',
        learningOutcome: {
          canDo: [
            'Present simple’dan odat, kundalik ish va umumiy faktlar uchun foydalanish',
            'He/She/It bilan -s qo‘shimchasini to‘g‘ri qo‘llash',
            'Inkor (don’t/doesn’t) va savol (do/does) shakllarini tuzish',
          ],
        },
        sortOrderDefault: 100,
        requiredFlag: true,
        estimatedEffortMin: 25,
        publishedBy: createdBy,
        publishedAt: new Date(),
      },
    });
  }
  // Skill-expectation membership (idempotent) — reference the STABLE expectation identity.
  for (const skillId of skillIds) {
    const expectation = await prisma.skillLevelExpectation.findUnique({ where: { skillId_levelId: { skillId, levelId } } });
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

/**
 * Re-sequence the three lessons' activities into a coherent teaching progression by pedagogical role.
 * View-only activities (EXPLANATION/EXAMPLE/TEXT/media) teach; MINI_QUESTION = recognition; PRACTICE =
 * production; MASTERY_TEST = mastery evidence (pulled from ALL three lessons into one mastery stage).
 */
function buildStagePlan(lessons: { contentKey: string; activities: { id: string; type: ActivityType }[] }[]): StagePlan[] {
  const roleOf = (type: ActivityType): 'teach' | 'recognition' | 'production' | 'mastery' | 'skip' => {
    if (type === ActivityType.MASTERY_TEST) return 'mastery';
    if (type === ActivityType.MINI_QUESTION) return 'recognition';
    if (type === ActivityType.PRACTICE) return 'production';
    const def = getActivityDefinition(type);
    if (def.executionKind === 'VIEW_ONLY') return 'teach';
    return 'skip';
  };
  const bindRole = (r: 'teach' | 'recognition' | 'production'): BlueprintBindingRole =>
    r === 'teach' ? BlueprintBindingRole.TEACH : r === 'recognition' ? BlueprintBindingRole.PRACTICE : BlueprintBindingRole.PRACTICE;

  const [l010, l011, l012] = lessons;
  const pick = (lesson: typeof lessons[number] | undefined, roles: ('teach' | 'recognition' | 'production' | 'mastery')[]) =>
    (lesson?.activities ?? []).filter((a) => roles.includes(roleOf(a.type) as never));

  const stages: StagePlan[] = [
    {
      stageKey: 'concept',
      stageType: 'concept',
      title: 'Present Simple — nima va nega',
      description: 'Odatlar, kundalik ishlar va umumiy faktlar. Tushunchani o‘qing.',
      bindings: pick(l010, ['teach']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.TEACH })),
    },
    {
      stageKey: 'recognition',
      stageType: 'recognition',
      title: 'Tanib olish',
      description: 'To‘g‘ri present simple shaklini taning.',
      bindings: pick(l010, ['recognition']).map((a) => ({ activityId: a.id, role: bindRole('recognition') })),
    },
    {
      stageKey: 'affirmative-production',
      stageType: 'production',
      title: 'Tasdiq gaplar — mashq',
      description: 'He/She/It uchun -s qo‘shimchasi bilan gap tuzing.',
      bindings: pick(l010, ['production']).map((a) => ({ activityId: a.id, role: bindRole('production') })),
    },
    {
      stageKey: 'negatives',
      stageType: 'production',
      title: 'Inkor gaplar',
      description: 'don’t / doesn’t bilan inkor shaklini o‘rganing va mashq qiling.',
      bindings: [...pick(l011, ['teach']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.TEACH })), ...pick(l011, ['recognition', 'production']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.PRACTICE }))],
    },
    {
      stageKey: 'questions',
      stageType: 'production',
      title: 'Savollar',
      description: 'do / does bilan savol tuzing.',
      bindings: [...pick(l012, ['teach']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.TEACH })), ...pick(l012, ['recognition', 'production']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.PRACTICE }))],
    },
    {
      stageKey: 'mastery',
      stageType: 'mastery',
      title: 'Mastery check',
      description: 'Bilimingizni mustaqil tekshiring.',
      bindings: lessons.flatMap((l) => pick(l, ['mastery']).map((a) => ({ activityId: a.id, role: BlueprintBindingRole.EVIDENCE }))),
    },
  ];
  // Drop empty non-mastery stages (robust to content variation); mastery must have evidence.
  const nonEmpty = stages.filter((s) => s.stageType === 'mastery' || s.bindings.length > 0);
  const mastery = nonEmpty.find((s) => s.stageType === 'mastery');
  if (!mastery || mastery.bindings.length === 0) throw new Error('no MASTERY_TEST activities found in the Present Simple lessons — cannot build mastery stage');
  return nonEmpty;
}

async function ensureBlueprint(prisma: PrismaService, roadmapPointId: string, createdBy: string, plan: StagePlan[]): Promise<{ blueprintId: string; blueprintRevisionId: string; stageCount: number; bindingCount: number }> {
  const existing = await prisma.teachingBlueprint.findUnique({ where: { roadmapPointId } });
  const blueprint = existing ?? (await prisma.teachingBlueprint.create({
    data: { roadmapPointId, status: ContainerStatus.DRAFT, createdBy },
  }));

  let revision = await prisma.teachingBlueprintRevision.findUnique({
    where: { blueprintId_versionNo: { blueprintId: blueprint.id, versionNo: 1 } },
  });
  if (!revision) {
    revision = await prisma.teachingBlueprintRevision.create({
      data: { blueprintId: blueprint.id, versionNo: 1, status: RevisionStatus.PUBLISHED, estimatedDurationMin: 25, publishedBy: createdBy, publishedAt: new Date() },
    });
  }

  // Seed stages + bindings only when the revision has no stages yet (atomic) — immutable published revision.
  let bindingCount = 0;
  const existingStageCount = await prisma.teachingBlueprintStage.count({ where: { blueprintRevisionId: revision.id } });
  if (existingStageCount === 0) {
    await prisma.$transaction(async (tx) => {
      let position = 1;
      for (const stage of plan) {
        const stageRow = await tx.teachingBlueprintStage.create({
          data: {
            blueprintRevisionId: revision!.id,
            stageKey: stage.stageKey,
            position,
            stageType: stage.stageType,
            config: { title: stage.title, description: stage.description },
          },
        });
        let bpos = 1;
        for (const b of stage.bindings) {
          await tx.teachingBlueprintContentBinding.create({
            data: { blueprintStageId: stageRow.id, activityId: b.activityId, role: b.role, position: bpos },
          });
          bpos++;
          bindingCount++;
        }
        position++;
      }
    });
  } else {
    bindingCount = await prisma.teachingBlueprintContentBinding.count({ where: { stage: { blueprintRevisionId: revision.id } } });
  }
  if (blueprint.publishedRevisionId !== revision.id || blueprint.status !== ContainerStatus.PUBLISHED) {
    await prisma.teachingBlueprint.update({ where: { id: blueprint.id }, data: { publishedRevisionId: revision.id, status: ContainerStatus.PUBLISHED } });
  }
  const stageCount = await prisma.teachingBlueprintStage.count({ where: { blueprintRevisionId: revision.id } });
  return { blueprintId: blueprint.id, blueprintRevisionId: revision.id, stageCount, bindingCount };
}

async function ensureMasteryRequirement(prisma: PrismaService, roadmapPointId: string, createdBy: string, expectationRevisionIds: string[]): Promise<{ requirementId: string; requirementRevisionId: string }> {
  const existing = await prisma.masteryRequirement.findUnique({ where: { roadmapPointId } });
  const requirement = existing ?? (await prisma.masteryRequirement.create({
    data: { roadmapPointId, status: ContainerStatus.DRAFT, createdBy },
  }));

  let revision = await prisma.masteryRequirementRevision.findUnique({
    where: { requirementId_versionNo: { requirementId: requirement.id, versionNo: 1 } },
  });
  if (!revision) {
    revision = await prisma.masteryRequirementRevision.create({
      data: {
        requirementId: requirement.id,
        versionNo: 1,
        status: RevisionStatus.PUBLISHED,
        gates: { thresholdBp: V2_MASTERY_THRESHOLD_BP, minIndependence: V2_MASTERY_MIN_INDEPENDENCE, requireAllRequiredSkills: true },
        policyVersion: V2_MASTERY_POLICY_VERSION,
        publishedBy: createdBy,
        publishedAt: new Date(),
      },
    });
  }
  for (const expectationRevisionId of expectationRevisionIds) {
    await prisma.masteryRequirementSkillExpectation.upsert({
      where: { requirementRevisionId_skillLevelExpectationRevisionId: { requirementRevisionId: revision.id, skillLevelExpectationRevisionId: expectationRevisionId } },
      create: {
        requirementRevisionId: revision.id,
        skillLevelExpectationRevisionId: expectationRevisionId,
        role: SkillContributionRole.REQUIRED,
        requiredEvidenceKinds: REQUIRED_EVIDENCE_KINDS,
        minIndependence: V2_MASTERY_MIN_INDEPENDENCE,
      },
      update: {},
    });
  }
  if (requirement.currentRevisionId !== revision.id || requirement.status !== ContainerStatus.PUBLISHED) {
    await prisma.masteryRequirement.update({ where: { id: requirement.id }, data: { currentRevisionId: revision.id, status: ContainerStatus.PUBLISHED } });
  }
  return { requirementId: requirement.id, requirementRevisionId: revision.id };
}

async function main(): Promise<void> {
  const logger = new Logger('ProvisionV2PresentSimple');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await provisionV2PresentSimple(app.get(PrismaService), {
      nodeEnv: process.env.NODE_ENV,
      allowDevFixture: process.env.ALLOW_DEV_FIXTURE,
    });
    logger.log(`V2 Present Simple point ready — point=${result.roadmapPointId} rev=${result.roadmapPointRevisionId} blueprintRev=${result.blueprintRevisionId} stages=${result.stageCount} bindings=${result.bindingCount} masteryRev=${result.masteryRequirementRevisionId}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('ProvisionV2PresentSimple').error(`V2 provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
