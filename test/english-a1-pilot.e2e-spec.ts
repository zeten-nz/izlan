import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, LessonStatus, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { projectActivityForLearnerRuntime } from '../src/content/activity/learner-activity-projection';
import { ObjectiveActivityScorerService } from '../src/lesson-execution/activity/objective-activity-scorer.service';
import { parseObjectiveActivityPayload } from '../src/lesson-execution/activity/objective-activity-payload';
import { PILOT_CONTENT_KEYS, PILOT_DIR, PILOT_IMPORT_FILES } from '../src/content-import/pilot/english-a1-pilot';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';
const loadFile = (file: string): unknown => JSON.parse(readFileSync(resolve(PILOT_DIR, file), 'utf8'));

/**
 * English A1 pilot — real application e2e (Phase 2.2E). Imports the ACTUAL repository pilot packages through the
 * canonical importer, publishes the whole pilot top-down + in prerequisite order via the existing workflow, and smoke-
 * tests the learner-safe projection and deterministic objective scoring. TEST DATABASE ONLY; nothing is auto-published
 * in dev/prod. Proves the first real educational content pack works end-to-end with the existing runtime.
 */
describe('English A1 pilot (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let n = 0;

  let admin: { token: string; userId: string };
  let subjectId: string;
  const topicIdByFile = new Map<string, string>();
  const importResponses: { file: string; validate: unknown; apply: unknown }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    authz = moduleRef.get(AuthorizationRepository);
    await reset();

    // 1. Authorized staff actor (ADMIN → content.author + content.publish + content.subject.manage; assignment via subject creation).
    admin = await makeAdmin();

    // 2. Hierarchy: English → General English → A1 → A1 Foundations → 4 Topics (existing CMS authorities, NOT bulk import).
    const subject = (await P(`${BASE}/subjects`, admin.token, { slug: `english-${uid()}`, title: 'English' })).body;
    subjectId = subject.id;
    const track = (await P(`${BASE}/subjects/${subjectId}/tracks`, admin.token, { slug: `general-english-${uid()}`, title: 'General English' })).body;
    const level = (await P(`${BASE}/tracks/${track.id}/levels`, admin.token, { code: 'A1', title: 'A1', sortOrder: 10 })).body;
    const mod = (await P(`${BASE}/levels/${level.id}/modules`, admin.token, { title: 'A1 Foundations', sortOrder: 10 })).body;
    for (let i = 0; i < PILOT_IMPORT_FILES.length; i++) {
      const topic = (await P(`${BASE}/modules/${mod.id}/topics`, admin.token, { title: `Topic ${i + 1}`, sortOrder: (i + 1) * 10 })).body;
      topicIdByFile.set(PILOT_IMPORT_FILES[i], topic.id);
    }

    // 3. Import each Topic package in manifest order via /validate then /apply.
    for (const file of PILOT_IMPORT_FILES) {
      const topicId = topicIdByFile.get(file)!;
      const doc = loadFile(file);
      const validate = await P(`${BASE}/topics/${topicId}/import/validate`, admin.token, doc);
      expect(validate.status).toBe(200);
      expect(validate.body.valid).toBe(true);
      const apply = await P(`${BASE}/topics/${topicId}/import/apply`, admin.token, doc);
      expect(apply.status).toBe(201);
      importResponses.push({ file, validate: validate.body, apply: apply.body });
    }
  }, 90_000);

  afterAll(async () => { await reset(); await app.close(); });

  async function reset() {
    await prisma.staffAudit.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(7000000 + n++).slice(-7)}`;
  const uid = () => String(n++);
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);

  async function makeUser() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }
  async function grantRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  const makeAdmin = async () => { const u = await makeUser(); await grantRole(u.userId, 'ADMIN'); return u; };

  // ── PILOT-E2E-01: real import of the whole pilot ──
  it('PILOT-E2E-01 imports 12 DRAFT lessons across 4 topics with correct mappings, prereqs, and one audit per topic', async () => {
    const lessons = await prisma.lesson.findMany({ where: { topic: { module: { level: { track: { subjectId } } } } } });
    expect(lessons).toHaveLength(12);
    expect(lessons.every((l) => l.status === LessonStatus.DRAFT && l.publishedRevisionId === null)).toBe(true);

    const revisions = await prisma.lessonRevision.findMany({ where: { lesson: { topic: { module: { level: { track: { subjectId } } } } } } });
    expect(revisions).toHaveLength(12);
    expect(revisions.every((r) => r.version === 1 && r.status === RevisionStatus.DRAFT)).toBe(true);

    // Skills reused across packages → exactly 13 distinct in the Subject (BE-AFFIRMATIVE redeclared, not duplicated).
    expect(await prisma.skill.count({ where: { subjectId } })).toBe(13);

    // Every lesson has >=1 LessonSkill; every objective activity contributes ActivitySkill rows.
    for (const l of lessons) expect(await prisma.lessonSkill.count({ where: { lessonId: l.id } })).toBeGreaterThanOrEqual(1);
    const activities = await prisma.activity.findMany({ where: { revision: { lesson: { topic: { module: { level: { track: { subjectId } } } } } } } });
    expect(activities).toHaveLength(96);
    expect(await prisma.activitySkill.count({ where: { activity: { id: { in: activities.map((a) => a.id) } } } })).toBeGreaterThanOrEqual(48);

    // Activity positions contiguous 0..N-1 per revision.
    for (const r of revisions) {
      const positions = activities.filter((a) => a.lessonRevisionId === r.id).map((a) => a.position).sort((x, y) => x - y);
      expect(positions).toEqual(positions.map((_, i) => i));
    }

    // Prerequisite chain 001→012 exactly.
    const byKey = new Map(lessons.map((l) => [l.contentKey, l]));
    for (let i = 1; i < PILOT_CONTENT_KEYS.length; i++) {
      const lesson = byKey.get(PILOT_CONTENT_KEYS[i])!;
      const prereq = byKey.get(PILOT_CONTENT_KEYS[i - 1])!;
      expect(await prisma.lessonPrerequisite.count({ where: { lessonId: lesson.id, prerequisiteLessonId: prereq.id } })).toBe(1);
    }
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: byKey.get(PILOT_CONTENT_KEYS[0])!.id } })).toBe(0);

    // ONE content.import.apply audit PER Topic import → 4, not 12.
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(4);
  });

  // ── PILOT-IMPORT-SAFETY (§43): import responses never leak authoring content ──
  it('PILOT-IMPORT-SAFETY validate/apply responses never contain answerKey / correctOptionIds / Markdown bodies', () => {
    for (const r of importResponses) {
      for (const body of [r.validate, r.apply]) {
        const json = JSON.stringify(body);
        expect(json).not.toContain('answerKey');
        expect(json).not.toContain('correctOptionIds');
        expect(json).not.toContain("Ko'p uchraydigan"); // a Markdown-body sentinel
      }
    }
  });

  // ── PILOT-PUBLISH-01 (§44/45/46): structurally publish the whole pilot in prerequisite order via the real workflow ──
  it('PILOT-PUBLISH-01 publishes the hierarchy top-down and every lesson in order 001→012 with no readiness blockers', async () => {
    // Top-down container publish.
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    await P(`${BASE}/subjects/${subjectId}/publish`, admin.token, { expectedUpdatedAt: subject!.updatedAt.toISOString() }).expect(201);
    const track = await prisma.track.findFirst({ where: { subjectId } });
    await P(`${BASE}/tracks/${track!.id}/publish`, admin.token, { expectedUpdatedAt: track!.updatedAt.toISOString() }).expect(201);
    const level = await prisma.level.findFirst({ where: { trackId: track!.id } });
    await P(`${BASE}/levels/${level!.id}/publish`, admin.token, { expectedUpdatedAt: level!.updatedAt.toISOString() }).expect(201);
    const mod = await prisma.module.findFirst({ where: { levelId: level!.id } });
    await P(`${BASE}/modules/${mod!.id}/publish`, admin.token, { expectedUpdatedAt: mod!.updatedAt.toISOString() }).expect(201);
    for (const topicId of topicIdByFile.values()) {
      const topic = await prisma.topic.findUnique({ where: { id: topicId } });
      await P(`${BASE}/topics/${topicId}/publish`, admin.token, { expectedUpdatedAt: topic!.updatedAt.toISOString() }).expect(201);
    }

    // Publish lessons in prerequisite order (001→012) via submit-review → readiness → publish.
    for (const key of PILOT_CONTENT_KEYS) {
      const lesson = await prisma.lesson.findUnique({ where: { contentKey: key } });
      const rev = await prisma.lessonRevision.findFirst({ where: { lessonId: lesson!.id } });
      await P(`${BASE}/revisions/${rev!.id}/submit-review`, admin.token, { expectedUpdatedAt: rev!.updatedAt.toISOString() }).expect(201);

      const readiness = (await G(`${BASE}/revisions/${rev!.id}/readiness`, admin.token)).body;
      expect(readiness.publishReady).toBe(true);
      expect(readiness.blockers).toEqual([]);

      const revFresh = await prisma.lessonRevision.findUnique({ where: { id: rev!.id } });
      const lessonFresh = await prisma.lesson.findUnique({ where: { id: lesson!.id } });
      await P(`${BASE}/revisions/${rev!.id}/publish`, admin.token, {
        expectedRevisionUpdatedAt: revFresh!.updatedAt.toISOString(),
        expectedLessonUpdatedAt: lessonFresh!.updatedAt.toISOString(),
      }).expect(201);

      const published = await prisma.lesson.findUnique({ where: { id: lesson!.id } });
      expect(published!.status).toBe(LessonStatus.PUBLISHED);
      expect(published!.publishedRevisionId).toBe(rev!.id);
    }

    // Final: all 12 PUBLISHED with correct current pointers.
    const all = await prisma.lesson.findMany({ where: { topic: { module: { level: { track: { subjectId } } } } } });
    expect(all).toHaveLength(12);
    expect(all.every((l) => l.status === LessonStatus.PUBLISHED && l.publishedRevisionId !== null)).toBe(true);
    for (const l of all) {
      const rev = await prisma.lessonRevision.findUnique({ where: { id: l.publishedRevisionId! } });
      expect(rev!.status).toBe(RevisionStatus.PUBLISHED);
    }
  }, 90_000);

  // ── PILOT-LEARNER-01 (§47): learner-safe projection of published pilot content ──
  it('PILOT-LEARNER-01 projects a published pilot lesson without leaking answerKey / authoring metadata', async () => {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey: 'ENG-A1-003-BE-AFFIRMATIVE' } });
    const activities = await prisma.activity.findMany({ where: { lessonRevisionId: lesson!.publishedRevisionId! }, orderBy: { position: 'asc' } });
    expect(activities.length).toBeGreaterThan(0);

    const projected = activities.map((a) => projectActivityForLearnerRuntime({ id: a.id, type: a.type, position: a.position, payload: a.payload }));
    const json = JSON.stringify(projected);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('createdBy'); // no DRAFT authoring metadata

    const obj = projected.find((p) => 'format' in p) as { format: string; prompt: string; options: { id: string; text: string }[] };
    expect(obj.format).toBe('single_choice');
    expect(obj.prompt.length).toBeGreaterThan(0);
    expect(obj.options.length).toBeGreaterThanOrEqual(2);
    const md = projected.find((p) => 'markdown' in p) as { markdown: string };
    expect(md.markdown.length).toBeGreaterThan(0);
    for (const p of projected) expect(p).not.toHaveProperty('payload');
  });

  // ── PILOT-SCORING-01 (§48): deterministic objective scoring on a real pilot objective, no AI ──
  it('PILOT-SCORING-01 scores a real published pilot objective deterministically (correct=10000, wrong=0)', async () => {
    const lesson = await prisma.lesson.findUnique({ where: { contentKey: 'ENG-A1-003-BE-AFFIRMATIVE' } });
    const objectiveRow = (await prisma.activity.findMany({ where: { lessonRevisionId: lesson!.publishedRevisionId! } }))
      .find((a) => a.type === ActivityType.MASTERY_TEST || a.type === ActivityType.MINI_QUESTION || a.type === ActivityType.PRACTICE)!;
    const payload = parseObjectiveActivityPayload(objectiveRow.payload);
    const correctId = payload.answerKey.correctOptionIds[0];
    const wrongId = payload.options.find((o) => o.id !== correctId)!.id;

    const scorer = new ObjectiveActivityScorerService();
    expect(scorer.score(payload, { selectedOptionId: correctId })).toEqual({ isCorrect: true, deterministicScore: 10000 });
    expect(scorer.score(payload, { selectedOptionId: wrongId })).toEqual({ isCorrect: false, deterministicScore: 0 });
  });
});
