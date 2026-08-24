import { Test, TestingModule } from '@nestjs/testing';
import { ContainerStatus, LessonStatus, RevisionStatus, AssessmentPurposeScope } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import {
  assertRuntimeFixtureAllowed,
  runRuntimeFixture,
  RUNTIME_LEARNER,
  RUNTIME_SUBJECT,
  RUNTIME_TRACK,
} from '../src/bootstrap/seed-runtime';
import { parsePlacementConfig } from '../src/assessment/engine/placement-config';
import { parseItemPayload, isObjectiveFormat } from '../src/assessment/scoring/item-payload';
import { parseObjectiveActivityPayload } from '../src/lesson-execution/activity/objective-activity-payload';
import { parseMarkdownActivityPayload } from '../src/content/activity/markdown-activity-payload';
import { projectActivityForLearnerRuntime } from '../src/content/activity/learner-activity-projection';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';

const ADMIN_PW = 'RuntimeAdmin!123';
const LEARNER_PW = 'RuntimeLearner!123';
const OK_ENV = { nodeEnv: 'test', allowDevFixture: 'true', adminPassword: ADMIN_PW, learnerPassword: LEARNER_PW };

describe('Runtime fixture (e2e, izlan_test)', () => {
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const hasher = new Argon2PasswordHasher();

  async function resetAll() {
    await cleanupRoadmapContent(prisma); // roadmap items, lessons/revisions/skills-links, topics/modules/levels
    await cleanupAssessmentTables(prisma); // assessment definition/version/item/pool + skills
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await resetAll();
    await bootstrapSystemRoles(authz);
  });
  afterAll(async () => {
    await resetAll();
    await mod.close();
  });
  beforeEach(async () => {
    await resetAll();
    await bootstrapSystemRoles(authz);
  });

  const deps = () => ({ prisma, authz, hasher });

  // ── production/opt-in guard ──
  it('RUNTIME-GUARD refuses in production, without the opt-in flag, and without the required passwords', () => {
    expect(() => assertRuntimeFixtureAllowed({ ...OK_ENV, nodeEnv: 'production' })).toThrow(/forbidden in production/);
    expect(() => assertRuntimeFixtureAllowed({ ...OK_ENV, allowDevFixture: undefined })).toThrow(/ALLOW_DEV_FIXTURE=true/);
    expect(() => assertRuntimeFixtureAllowed({ ...OK_ENV, allowDevFixture: 'false' })).toThrow(/ALLOW_DEV_FIXTURE=true/);
    expect(() => assertRuntimeFixtureAllowed({ ...OK_ENV, adminPassword: undefined })).toThrow(/required/);
    expect(() => assertRuntimeFixtureAllowed({ ...OK_ENV, learnerPassword: undefined })).toThrow(/required/);
    expect(assertRuntimeFixtureAllowed(OK_ENV)).toEqual({ adminPassword: ADMIN_PW, learnerPassword: LEARNER_PW });
  });

  // ── published content + valid placement pool ──
  it('RUNTIME-CONTENT publishes a learner-visible subject/track, 3 published lessons, and a valid placement pool', async () => {
    const r = await runRuntimeFixture(deps(), OK_ENV);

    const subject = await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } });
    expect(subject?.status).toBe(ContainerStatus.PUBLISHED);
    const track = await prisma.track.findFirst({ where: { slug: RUNTIME_TRACK.slug } });
    expect(track?.status).toBe(ContainerStatus.PUBLISHED);

    // 3 published, learner-visible lessons (published revision + coherent pointer + a skill mapping)
    const lessons = await prisma.lesson.findMany({ where: { id: { in: r.lessonIds } }, include: { publishedRevision: true, skills: true } });
    expect(lessons).toHaveLength(3);
    for (const l of lessons) {
      expect(l.status).toBe(LessonStatus.PUBLISHED);
      expect(l.publishedRevisionId).toBeTruthy();
      expect(l.publishedRevision?.status).toBe(RevisionStatus.PUBLISHED);
      expect(l.publishedRevision?.lessonId).toBe(l.id); // pointer coherence
      expect(l.skills.length).toBeGreaterThanOrEqual(1);
    }

    // Phase 04: each lesson has real learner activities (1 view-only + 3 objective, objectives mapped to the skill),
    // and the learner projection strips answerKey.
    for (const l of lessons) {
      const acts = await prisma.activity.findMany({ where: { lessonRevisionId: l.publishedRevisionId! }, orderBy: { position: 'asc' }, include: { skills: true } });
      expect(acts).toHaveLength(4);
      const markdown = acts.find((a) => a.type === 'EXPLANATION');
      expect(markdown).toBeTruthy();
      expect(() => parseMarkdownActivityPayload(markdown!.payload)).not.toThrow();
      const objectives = acts.filter((a) => a.type === 'MINI_QUESTION' || a.type === 'PRACTICE');
      expect(objectives).toHaveLength(3);
      for (const o of objectives) {
        expect(() => parseObjectiveActivityPayload(o.payload)).not.toThrow();
        expect(o.skills.length).toBeGreaterThanOrEqual(1); // mapped to the lesson skill (real evidence + review trigger)
        const projected = JSON.stringify(projectActivityForLearnerRuntime({ id: o.id, type: o.type, position: o.position, payload: o.payload }));
        expect(projected).not.toContain('answerKey');
        expect(projected).not.toContain('correctOptionIds');
      }
    }

    // exactly one PUBLISHED DIAGNOSTIC definition with a published current version
    const def = await prisma.assessmentDefinition.findFirst({ where: { subjectId: r.subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, status: ContainerStatus.PUBLISHED } });
    expect(def?.currentVersionId).toBe(r.versionId);
    const version = await prisma.assessmentDefinitionVersion.findUnique({ where: { id: r.versionId } });
    expect(version?.status).toBe(RevisionStatus.PUBLISHED);

    // config + every pooled item payload pass the engine's OWN validators, and every format is objective
    expect(() => parsePlacementConfig(version!.config)).not.toThrow();
    const pool = await prisma.assessmentVersionItem.findMany({ where: { versionId: r.versionId }, include: { item: true } });
    expect(pool).toHaveLength(6);
    for (const row of pool) {
      const payload = parseItemPayload(row.item.payload);
      expect(isObjectiveFormat(payload.format)).toBe(true);
      expect(row.item.difficulty).toBeGreaterThanOrEqual(1);
      expect(row.item.difficulty).toBeLessThanOrEqual(6);
    }
    // each of the 3 skills carries itemsPerSkill(=2) items → coverage is feasible
    const bySkill = new Map<string, number>();
    for (const row of pool) bySkill.set(row.item.skillId, (bySkill.get(row.item.skillId) ?? 0) + 1);
    expect([...bySkill.values()].every((n) => n >= 2)).toBe(true);
    expect(bySkill.size).toBe(3);
  });

  // ── pre-onboarded runtime learner + intent ──
  it('RUNTIME-LEARNER creates a dedicated, pre-onboarded runtime learner with a current intent (demo learner untouched)', async () => {
    const r = await runRuntimeFixture(deps(), OK_ENV);
    const learner = await prisma.user.findUnique({ where: { phone: RUNTIME_LEARNER.phone }, include: { profile: true, passwordCredential: true } });
    expect(learner?.id).toBe(r.learnerId);
    expect(learner?.profile?.onboardingCompletedAt).toBeTruthy(); // ready for placement
    expect(learner?.profile?.timezone).toBe('Asia/Tashkent');
    expect(learner?.passwordCredential?.passwordHash).toMatch(/^\$argon2id\$/);

    const intents = await prisma.learnerLearningIntent.findMany({ where: { userId: r.learnerId } });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ subjectId: r.subjectId, trackId: r.trackId });

    // the fixture must NOT create the diagnostic attempt / snapshot / roadmap (those come from the real flow)
    expect(await prisma.assessmentAttempt.count({ where: { userId: r.learnerId } })).toBe(0);
    expect(await prisma.learnerRoadmap.count({ where: { userId: r.learnerId } })).toBe(0);
    // and it must NOT touch the demo learner
    expect(await prisma.user.findUnique({ where: { phone: '+998900000003' } })).toBeNull();
  });

  // ── idempotency ──
  it('RUNTIME-IDEMPOTENT reruns without creating duplicate subject/track/definition/version/pool/lessons/learner', async () => {
    const first = await runRuntimeFixture(deps(), OK_ENV);
    const second = await runRuntimeFixture(deps(), OK_ENV);

    expect(second.subjectId).toBe(first.subjectId);
    expect(second.trackId).toBe(first.trackId);
    expect(second.definitionId).toBe(first.definitionId);
    expect(second.versionId).toBe(first.versionId);
    expect(second.learnerId).toBe(first.learnerId);
    expect(second.poolSize).toBe(6);

    expect(await prisma.subject.count({ where: { slug: RUNTIME_SUBJECT.slug } })).toBe(1);
    expect(await prisma.track.count({ where: { slug: RUNTIME_TRACK.slug } })).toBe(1);
    expect(await prisma.assessmentDefinition.count({ where: { subjectId: first.subjectId } })).toBe(1);
    expect(await prisma.assessmentDefinitionVersion.count({ where: { definitionId: first.definitionId } })).toBe(1);
    expect(await prisma.assessmentVersionItem.count({ where: { versionId: first.versionId } })).toBe(6);
    expect(await prisma.assessmentItem.count({ where: { definitionId: first.definitionId } })).toBe(6);
    expect(await prisma.lesson.count({ where: { topicId: first.topicId } })).toBe(3);
    expect(await prisma.learnerLearningIntent.count({ where: { userId: first.learnerId } })).toBe(1);
    // activities are seeded once per lesson revision (4 each × 3 lessons = 12), never duplicated on rerun
    const revs = await prisma.lesson.findMany({ where: { id: { in: first.lessonIds } }, select: { publishedRevisionId: true } });
    const revIds = revs.map((l) => l.publishedRevisionId!).filter(Boolean);
    expect(await prisma.activity.count({ where: { lessonRevisionId: { in: revIds } } })).toBe(12);
  });
});
