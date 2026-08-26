import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { runRuntimeFixture } from '../src/bootstrap/seed-runtime';
import { ImportService } from '../src/content-import/import.service';
import { SubjectService } from '../src/content-authoring/subject.service';
import { HierarchyService } from '../src/content-authoring/hierarchy.service';
import { HierarchyPublishService } from '../src/content-authoring/publish/hierarchy-publish.service';
import { PublicationService } from '../src/content-authoring/publish/publication.service';
import { RevisionService } from '../src/content-authoring/revision.service';
import { ActivityService } from '../src/content-authoring/activity.service';
import { SkillMappingService } from '../src/content-authoring/skill-mapping.service';
import { provisionEnglishA1, refreshPilotContent, A1_DIAGNOSTIC_ITEMS } from '../src/bootstrap/provision-english-a1';
import { PILOT_CONTENT_KEYS } from '../src/content-import/pilot/english-a1-pilot';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const SEED_ENV = { nodeEnv: 'test', allowDevFixture: 'true', adminPassword: 'DemoAdmin!123', learnerPassword: 'DemoLearner!123' };
const PROV_ENV = { nodeEnv: 'test', allowDevFixture: 'true' };
const SUBJECT_SLUG = 'english-a1-dev';

/**
 * English A1 dev provisioning — reproducibility e2e (izlan_test). Proves the ONE provisioning tool reconstructs the
 * working curriculum + placement bridge from the normal seed state, is idempotent, never mutates the published v1
 * diagnostic, and that a fresh learner then reaches all 12 real lessons via Placement → Roadmap → Daily Plan → Lesson.
 */
describe('Provision English A1 (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();

  const deps = () => ({
    prisma,
    subjects: mod.get(SubjectService, { strict: false }),
    hierarchy: mod.get(HierarchyService, { strict: false }),
    importer: mod.get(ImportService, { strict: false }),
    hierarchyPublish: mod.get(HierarchyPublishService, { strict: false }),
    publication: mod.get(PublicationService, { strict: false }),
    revisions: mod.get(RevisionService, { strict: false }),
    activities: mod.get(ActivityService, { strict: false }),
    mappings: mod.get(SkillMappingService, { strict: false }),
  });

  // Lesson-execution/reward/mission artifacts hold RESTRICT FKs to activity/revision — clear (canonical order, mirrors
  // lesson-completion.e2e) before the content cleanup helpers.
  async function wipe() {
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.rewardGrant.deleteMany();
    await prisma.aiEvaluation.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.dailyPlanItem.deleteMany();
    await prisma.dailyPlan.deleteMany();
    await cleanupRoadmapContent(prisma);
    await cleanupAssessmentTables(prisma);
    await prisma.staffAudit.deleteMany();
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }

  async function resetAndSeed() {
    await wipe();
    await bootstrapSystemRoles(authz);
    await runRuntimeFixture({ prisma, authz, hasher: new Argon2PasswordHasher() }, SEED_ENV);
  }

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = mod.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await resetAndSeed();
  }, 120_000);

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  const subjectId = async () => (await prisma.subject.findUniqueOrThrow({ where: { slug: SUBJECT_SLUG } })).id;
  const scope = async () => ({ topic: { module: { level: { track: { subjectId: await subjectId() } } } } });
  async function diagnostic() {
    const sid = await subjectId();
    const def = await prisma.assessmentDefinition.findFirstOrThrow({ where: { subjectId: sid, purposeScope: 'DIAGNOSTIC', status: 'PUBLISHED' }, include: { versions: true } });
    const cur = def.versions.find((v) => v.id === def.currentVersionId)!;
    const rows = await prisma.assessmentVersionItem.findMany({ where: { versionId: cur.id }, include: { item: { select: { skillId: true } } } });
    return { def, cur, versions: def.versions, poolSize: rows.length, distinctSkills: new Set(rows.map((r) => r.item.skillId)).size };
  }

  it('PROV-E2E-01 reconstructs 4 topics + 12 published lessons + 13 skills and a diagnostic covering all 13 (new version; v1 untouched)', async () => {
    // Baseline (seed): the fixture diagnostic measures only 3 skills.
    const before = await diagnostic();
    expect(before.cur.versionNo).toBe(1);
    expect(before.distinctSkills).toBe(3);
    const v1PoolBefore = before.poolSize;
    const v1ConfigBefore = JSON.stringify(before.cur.config);

    const r = await provisionEnglishA1(deps(), PROV_ENV);
    expect(r.topics).toBe(4);
    expect(r.pilotLessonsPublished).toBe(12);
    expect(r.pilotSkills).toBe(13);
    expect(r.diagnostic.createdNewVersion).toBe(true);
    expect(r.diagnostic.distinctSkills).toBe(13);
    expect(r.diagnostic.poolSize).toBe(13);

    // Content: 12 pilot lessons PUBLISHED with coherent published revisions; 114 pilot activities.
    const pilot = await prisma.lesson.findMany({ where: { contentKey: { in: [...PILOT_CONTENT_KEYS] } } });
    expect(pilot).toHaveLength(12);
    expect(pilot.every((l) => l.status === 'PUBLISHED' && l.publishedRevisionId)).toBe(true);
    expect(await prisma.activity.count({ where: { revision: { lesson: { contentKey: { in: [...PILOT_CONTENT_KEYS] } }, status: 'PUBLISHED' } } })).toBe(114);
    expect(await prisma.skill.count({ where: { subjectId: await subjectId(), code: { startsWith: 'ENG-A1-' }, NOT: { code: { startsWith: 'ENG-A1-DEV' } } } })).toBe(13);

    // Diagnostic: the CURRENT version now measures all 13 pilot skills.
    const after = await diagnostic();
    expect(after.distinctSkills).toBe(13);
    expect(after.poolSize).toBe(13);
    expect(after.cur.versionNo).toBe(2);

    // v1 (the seeded 3-skill pool) was NOT mutated — same pool size, same distinct skills, same config.
    const v1 = after.versions.find((v) => v.versionNo === 1)!;
    const v1Rows = await prisma.assessmentVersionItem.findMany({ where: { versionId: v1.id }, include: { item: { select: { skillId: true } } } });
    expect(v1Rows).toHaveLength(v1PoolBefore);
    expect(new Set(v1Rows.map((x) => x.item.skillId)).size).toBe(3);
    expect(JSON.stringify(v1.config)).toBe(v1ConfigBefore);
  }, 120_000);

  it('PROV-E2E-02 is idempotent on rerun — no new version, no duplicate items/topics/lessons/skills/contentKeys', async () => {
    const beforeVersions = (await diagnostic()).versions.length;
    const beforeCurrent = (await diagnostic()).cur.id;
    const beforePoolSize = (await diagnostic()).poolSize;
    const beforeItems = await prisma.assessmentItem.count();
    const beforeTopics = await prisma.topic.count({ where: await scope().then((s) => s.topic) });
    const beforeLessons = await prisma.lesson.count({ where: await scope() });
    const beforeSkills = await prisma.skill.count({ where: { subjectId: await subjectId() } });

    const r2 = await provisionEnglishA1(deps(), PROV_ENV);
    expect(r2.diagnostic.createdNewVersion).toBe(false); // reused, no new version
    expect(r2.diagnostic.distinctSkills).toBe(13);

    const after = await diagnostic();
    expect(after.versions.length).toBe(beforeVersions); // no extra version
    expect(after.cur.id).toBe(beforeCurrent); // currentVersionId unchanged
    expect(after.poolSize).toBe(beforePoolSize); // no duplicate pool items
    expect(await prisma.assessmentItem.count()).toBe(beforeItems); // no duplicate items authored
    expect(await prisma.topic.count({ where: await scope().then((s) => s.topic) })).toBe(beforeTopics);
    expect(await prisma.lesson.count({ where: await scope() })).toBe(beforeLessons);
    expect(await prisma.skill.count({ where: { subjectId: await subjectId() } })).toBe(beforeSkills);
    // no duplicate contentKeys globally
    const dupes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM (SELECT content_key FROM lesson GROUP BY content_key HAVING count(*) > 1) d`);
    expect(Number(dupes[0].n)).toBe(0);
  }, 120_000);

  it('PROV-E2E-03 fresh learner reaches all 12 real lessons: Placement (13 skills) → Roadmap (12) → Daily Plan → complete a Lesson', async () => {
    const srv = () => app.getHttpServer();
    const ok = (s: number) => s >= 200 && s < 300;
    const phone = '+998900079001';
    const otp = await request(srv()).post('/api/auth/otp/request').send({ phone });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: otp.body.challengeId, code: sms.latestCode(), password: 'LearnerPass!123' });
    const tok = reg.body.accessToken as string;
    const A = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);
    await A(request(srv()).patch('/api/profile/me')).send({ displayName: 'QA', dateOfBirth: '2000-01-01', timezone: 'Asia/Tashkent' });
    const subject = (await A(request(srv()).get('/api/onboarding/subjects'))).body.find((s: { slug: string }) => s.slug === SUBJECT_SLUG);
    const track = (await A(request(srv()).get(`/api/onboarding/subjects/${subject.id}/tracks`))).body[0];
    await A(request(srv()).put('/api/onboarding/learning-intent')).send({ subjectId: subject.id, trackId: track.id });
    await A(request(srv()).post('/api/onboarding/complete')).send({});
    const lid = (await A(request(srv()).get('/api/onboarding/learning-intents'))).body.find((i: { subject: { id: string } }) => i.subject.id === subject.id).id;

    // Placement: answer every served item.
    let view = (await A(request(srv()).post('/api/assessments/placement/start')).send({ learningIntentId: lid })).body;
    let answered = 0;
    while (view.status === 'IN_PROGRESS' && view.item && answered < 30) {
      const ans = view.item.format === 'multiple_choice' ? { selectedOptionIds: [view.item.options[0].id] } : { selectedOptionId: view.item.options[0].id };
      view = (await A(request(srv()).post(`/api/assessments/attempts/${view.attemptId}/responses`)).send({ itemId: view.item.id, answer: ans })).body;
      answered++;
    }
    expect(view.status).toBe('COMPLETED');
    expect(answered).toBe(13); // measured all 13 pilot skills

    const derive = await A(request(srv()).post(`/api/skill-profile/diagnostics/${view.attemptId}/derive`)).send({});
    expect(derive.body.skills).toHaveLength(13);

    const rm = await A(request(srv()).post(`/api/roadmaps/diagnostics/${view.attemptId}/initial`)).send({});
    const roadmap = (await A(request(srv()).get(`/api/roadmaps/${rm.body.roadmap?.id ?? rm.body.id}`))).body;
    expect((roadmap.items ?? []).length).toBe(12); // the full real curriculum

    const dp = await A(request(srv()).post('/api/daily-plans/today')).send({});
    expect(dp.status === 200 || dp.status === 201).toBe(true);
    const mustDo = (dp.body.items ?? []).find((i: { kind: string; itemType: string }) => i.kind === 'MUST_DO' && i.itemType === 'LESSON');
    expect(mustDo).toBeTruthy();
    expect(mustDo.state).toBe('AVAILABLE');

    // Open + complete the first real lesson.
    const start = await A(request(srv()).post(`/api/lesson-executions/daily-plan-items/${mustDo.id}/start`)).send({});
    expect(ok(start.status)).toBe(true);
    const lessonId = start.body.lessonId;
    const acts: { id: string; type: string; format?: string; options?: { id: string }[] }[] = start.body.activities;
    expect(acts.length).toBeGreaterThan(0);
    const OBJ = new Set(['MINI_QUESTION', 'PRACTICE', 'MASTERY_TEST']);
    for (const a of acts) {
      if (OBJ.has(a.type)) {
        const answer = a.format === 'multiple_choice' ? { selectedOptionIds: [a.options![0].id] } : { selectedOptionId: a.options![0].id };
        await A(request(srv()).post(`/api/lesson-executions/${lessonId}/activities/${a.id}/attempts`)).send({ clientRequestId: crypto.randomUUID(), answer }).expect(200);
      } else {
        await A(request(srv()).post(`/api/lesson-executions/${lessonId}/activities/${a.id}/complete`)).send({}).expect(200);
      }
    }
    const done = await A(request(srv()).post(`/api/lesson-executions/${lessonId}/complete`)).send({});
    expect(ok(done.status)).toBe(true);
    const completed = await prisma.learnerLessonCompletion.count({ where: { lessonId } });
    expect(completed).toBe(1); // real completion recorded — no hidden DB steps
  }, 120_000);

  it('PROV-E2E-04 content refresh is idempotent (unchanged → 0) and forced refresh publishes a NEW revision (v1 archived)', async () => {
    const sid = await subjectId();
    const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '+998900000001' } });

    // Idempotent: the packages match the just-imported content → nothing to refresh, no new revisions created.
    const revsBefore = await prisma.lessonRevision.count();
    expect(await refreshPilotContent(deps(), sid, admin.id)).toBe(0);
    expect(await prisma.lessonRevision.count()).toBe(revsBefore);

    // Forced refresh of one lesson exercises the REAL create-revision → author activities → map skills → review → publish
    // path, respecting immutability (old published revision archived, pointer repointed).
    const l1before = await prisma.lesson.findUniqueOrThrow({ where: { contentKey: 'ENG-A1-001-GREETINGS' } });
    expect(await refreshPilotContent(deps(), sid, admin.id, { force: true, only: ['ENG-A1-001-GREETINGS'] })).toBe(1);

    const l1after = await prisma.lesson.findUniqueOrThrow({ where: { contentKey: 'ENG-A1-001-GREETINGS' }, include: { publishedRevision: { include: { activities: true } } } });
    expect(l1after.publishedRevision!.version).toBe(2); // a new published revision
    expect(l1after.publishedRevisionId).not.toBe(l1before.publishedRevisionId); // pointer repointed
    expect((await prisma.lessonRevision.findUniqueOrThrow({ where: { id: l1before.publishedRevisionId! } })).status).toBe('ARCHIVED'); // v1 archived, not edited
    expect(l1after.publishedRevision!.activities.length).toBeGreaterThan(0);
    // Activity-skill mappings reconciled: every objective activity in v2 maps to >= 1 skill.
    const objectiveIds = l1after.publishedRevision!.activities.filter((a) => ['MINI_QUESTION', 'PRACTICE', 'MASTERY_TEST'].includes(a.type)).map((a) => a.id);
    expect(objectiveIds.length).toBeGreaterThan(0);
    expect(await prisma.activitySkill.count({ where: { activityId: { in: objectiveIds } } })).toBeGreaterThanOrEqual(objectiveIds.length);
  }, 120_000);
});
