import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

describe('Review candidates (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const nx = () => so++;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await reset();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); });

  async function reset() {
    await prisma.learnerSignal.deleteMany();
    await prisma.learnerLessonCompletion.deleteMany();
    await prisma.learnerLessonProgress.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } }); // break circular FK before deleting revisions
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.skill.deleteMany(); // references subject (RESTRICT) — after lessonSkill/activitySkill/signals
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function makeSubjectTrack(creatorId: string) {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  }
  const makeSkill = (subjectId: string, name: string, sortOrder = nx()) => prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder } }).then((s) => s.id);
  async function makeTopic(creatorId: string, trackId: string, status: ContainerStatus = ContainerStatus.PUBLISHED) {
    const level = await prisma.level.create({ data: { trackId, code: `C-${uid()}`, title: 'Lvl', sortOrder: nx(), status, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'Mod', sortOrder: nx(), status, createdBy: creatorId } });
    return (await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nx(), status, createdBy: creatorId } })).id;
  }
  async function makeLesson(creatorId: string, topicId: string, title = 'Lesson', lessonSkillIds: string[] = [], status: LessonStatus = LessonStatus.PUBLISHED, sortOrder = nx()) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder, status, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of lessonSkillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const makeActivity = (revisionId: string, position: number, skillIds: string[] = []) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type: 'PRACTICE', position, payload: { note: 'x' }, source: ContentSource.HUMAN } }).then(async (a) => {
      for (const sid of skillIds) await prisma.activitySkill.create({ data: { activityId: a.id, skillId: sid } });
      return a.id;
    });
  async function publishV2(creatorId: string, lessonId: string) {
    await prisma.lessonRevision.updateMany({ where: { lessonId, status: RevisionStatus.PUBLISHED }, data: { status: RevisionStatus.ARCHIVED } });
    const v2 = await prisma.lessonRevision.create({ data: { lessonId, version: 2, title: 'V2', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lessonId }, data: { publishedRevisionId: v2.id } });
    return v2.id;
  }
  const seenInProgress = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: revisionId, status: 'IN_PROGRESS' } });
  const seenCompleted = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: revisionId, completionNo: 1 } });
  const signal = (userId: string, subjectId: string, skillId: string | null, type: string, status = 'ACTIVE', evidenceRefs: object = { schemaVersion: 'x' }) =>
    prisma.learnerSignal.create({ data: { userId, subjectId, skillId, type, status: status as never, evidenceRefs } });
  const rmSignal = (userId: string, subjectId: string, skillId: string, triggerActivityIds: string[]) =>
    signal(userId, subjectId, skillId, 'REPEATED_MISTAKE', 'ACTIVE', { schemaVersion: 'repeated-mistake-signal/v1', triggerActivityIds, triggerAttemptIds: triggerActivityIds.map(() => 'x') });

  const get = (token: string, subjectId: string) => request(server()).get(`/api/review-candidates/me/subjects/${subjectId}`).set('Authorization', `Bearer ${token}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const group = (body: any, skillId: string): any => body.groups.find((g: any) => g.skill.id === skillId);

  // ───────────────────────────────────────────────────────────────────────────

  it('§48/§49/§29 no ACTIVE supported signals (RESOLVED ignored) → 200 empty', async () => {
    const { token, userId } = await makeLearner('+998900003001');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]);
    await seenCompleted(userId, A.lessonId, A.revisionId);
    await signal(userId, subjectId, g, 'WEAK_SKILL', 'RESOLVED'); // resolved → ignored

    const res = await get(token, subjectId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subjectId, groups: [], uncoveredSkillIds: [] });
  });

  it('§50/§51/§52 unseen content excluded; exposure IN_PROGRESS vs COMPLETED (completion wins)', async () => {
    const { token, userId } = await makeLearner('+998900003002');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g], LessonStatus.PUBLISHED, 1);
    const B = await makeLesson(userId, topic, 'B', [g], LessonStatus.PUBLISHED, 2);
    const C = await makeLesson(userId, topic, 'C', [g], LessonStatus.PUBLISHED, 3);
    await seenInProgress(userId, A.lessonId, A.revisionId); // only A encountered
    await signal(userId, subjectId, g, 'WEAK_SKILL');

    let cand = group((await get(token, subjectId)).body, g)!.candidates;
    expect(cand.map((c: { lesson: { id: string } }) => c.lesson.id)).toEqual([A.lessonId]); // B/C unseen → excluded
    expect(cand[0].exposure).toBe('IN_PROGRESS');

    await seenCompleted(userId, A.lessonId, A.revisionId); // now also completed → COMPLETED wins
    cand = group((await get(token, subjectId)).body, g)!.candidates;
    expect(cand[0].exposure).toBe('COMPLETED');
  });

  it('§53/§54/§55 LessonSkill maps; current ActivitySkill maps; title inference does NOT', async () => {
    const { token, userId } = await makeLearner('+998900003003');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]); // LessonSkill g
    const B = await makeLesson(userId, topic, 'B', []); // ActivitySkill g on current revision
    await makeActivity(B.revisionId, 1, [g]);
    const C = await makeLesson(userId, topic, 'Advanced Grammar', []); // title only, no mapping
    for (const L of [A, B, C]) await seenCompleted(userId, L.lessonId, L.revisionId);
    await signal(userId, subjectId, g, 'WEAK_SKILL');

    const ids = group((await get(token, subjectId)).body, g)!.candidates.map((c: { lesson: { id: string } }) => c.lesson.id).sort();
    expect(ids).toEqual([A.lessonId, B.lessonId].sort()); // C excluded (no inference)
  });

  it('§56/§57/§58 direct trigger (historical revision) → candidate; archived trigger lesson excluded', async () => {
    const { token, userId } = await makeLearner('+998900003004');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    // Lesson A: trigger activity X in v1; then republish v2 (no g mapping). Encountered + still visible.
    const A = await makeLesson(userId, topic, 'A', []);
    const x = await makeActivity(A.revisionId, 1, []); // trigger activity (v1)
    await seenInProgress(userId, A.lessonId, A.revisionId);
    await publishV2(userId, A.lessonId); // A now v2; X belongs to archived v1
    // Lesson D: trigger activity, but lesson archived.
    const D = await makeLesson(userId, topic, 'D', []);
    const d = await makeActivity(D.revisionId, 1, []);
    await seenInProgress(userId, D.lessonId, D.revisionId);
    await prisma.lesson.update({ where: { id: D.lessonId }, data: { status: LessonStatus.ARCHIVED } });
    await rmSignal(userId, subjectId, g, [x, d]);

    const cand = group((await get(token, subjectId)).body, g)!.candidates;
    expect(cand.map((c: { lesson: { id: string } }) => c.lesson.id)).toEqual([A.lessonId]); // D archived → excluded
    expect(cand[0].directTrigger).toBe(true); // §57 logical lesson, historical-revision trigger
  });

  it('§59 general discovery uses CURRENT revision mapping only (obsolete v1 mapping does not count)', async () => {
    const { token, userId } = await makeLearner('+998900003005');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', []); // no LessonSkill
    await makeActivity(A.revisionId, 1, [g]); // v1 ActivitySkill g
    await seenInProgress(userId, A.lessonId, A.revisionId);
    await publishV2(userId, A.lessonId); // v2 has no activities / no g mapping
    await signal(userId, subjectId, g, 'WEAK_SKILL'); // general discovery only

    const res = await get(token, subjectId);
    expect(res.body.groups).toEqual([]); // A not selected via general (current v2 has no g mapping, no LessonSkill)
    expect(res.body.uncoveredSkillIds).toEqual([g]);
  });

  it('§60/§61 multiple signals + mappings same skill → one group, one candidate, canonical signalTypes', async () => {
    const { token, userId } = await makeLearner('+998900003006');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]); // LessonSkill
    const x = await makeActivity(A.revisionId, 1, [g]); // ActivitySkill + trigger
    await seenCompleted(userId, A.lessonId, A.revisionId);
    await signal(userId, subjectId, g, 'WEAK_SKILL');
    await signal(userId, subjectId, g, 'REVIEW_DUE');
    await rmSignal(userId, subjectId, g, [x]);

    const grp = group((await get(token, subjectId)).body, g)!;
    expect(grp.signalTypes).toEqual(['REPEATED_MISTAKE', 'REVIEW_DUE', 'WEAK_SKILL']);
    expect(grp.candidates).toHaveLength(1);
    expect(grp.candidates[0].directTrigger).toBe(true);
  });

  it('§62/§63/§64 multi-skill groups; cross-subject excluded; hidden content excluded', async () => {
    const { token, userId } = await makeLearner('+998900003007');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar', 0);
    const v = await makeSkill(subjectId, 'Vocab', 1);
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]);
    const B = await makeLesson(userId, topic, 'B', [v]);
    await seenCompleted(userId, A.lessonId, A.revisionId);
    await seenCompleted(userId, B.lessonId, B.revisionId);
    await signal(userId, subjectId, g, 'WEAK_SKILL');
    await signal(userId, subjectId, v, 'REVIEW_DUE');

    // Cross-subject: a lesson in another subject, mapped to g, encountered → must NOT leak.
    const other = await makeSubjectTrack(userId);
    const otherTopic = await makeTopic(userId, other.trackId);
    const X = await makeLesson(userId, otherTopic, 'X', [g]); // g belongs subjectId; cross-subject mapping
    await seenCompleted(userId, X.lessonId, X.revisionId);

    const body = (await get(token, subjectId)).body;
    expect(body.groups.map((gr: { skill: { id: string } }) => gr.skill.id)).toEqual([g, v]); // ordered by sortOrder
    expect(group(body, g)!.candidates.map((c: { lesson: { id: string } }) => c.lesson.id)).toEqual([A.lessonId]); // X excluded

    // §64 hidden content: archive A's topic → A no longer visible
    await prisma.topic.update({ where: { id: topic }, data: { status: ContainerStatus.ARCHIVED } });
    const body2 = (await get(token, subjectId)).body;
    expect(body2.groups.some((gr: { skill: { id: string } }) => gr.skill.id === g)).toBe(false);
    expect(body2.uncoveredSkillIds).toContain(g);
  });

  it('§68/§69/§70 read does not resolve signals; uncovered skill; malformed evidence fallback', async () => {
    const { token, userId } = await makeLearner('+998900003008');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const w = await makeSkill(subjectId, 'Weak');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]);
    await seenCompleted(userId, A.lessonId, A.revisionId);
    // §70 malformed REPEATED_MISTAKE evidence + a valid LessonSkill candidate
    await signal(userId, subjectId, g, 'REPEATED_MISTAKE', 'ACTIVE', { schemaVersion: 'repeated-mistake-signal/v1', triggerActivityIds: 'not-an-array' });
    await signal(userId, subjectId, w, 'WEAK_SKILL'); // §69 no encountered mapped visible lesson → uncovered

    const body = (await get(token, subjectId)).body;
    const grp = group(body, g)!;
    expect(grp.candidates.map((c: { lesson: { id: string }; directTrigger: boolean }) => [c.lesson.id, c.directTrigger])).toEqual([[A.lessonId, false]]); // normal candidate, malformed → directTrigger false
    expect(body.uncoveredSkillIds).toContain(w);

    // §68/§36 signals unchanged by the read
    expect(await prisma.learnerSignal.count({ where: { userId, status: 'ACTIVE' } })).toBe(2);
    expect(await prisma.learnerSignal.count({ where: { userId, status: 'RESOLVED' } })).toBe(0);
  });

  it('§71/§72 deterministic ordering (direct first, then hierarchy) + no candidate cap', async () => {
    const { token, userId } = await makeLearner('+998900003009');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const lessons: { lessonId: string; revisionId: string }[] = [];
    for (let i = 0; i < 7; i++) lessons.push(await makeLesson(userId, topic, `L${i}`, [g], LessonStatus.PUBLISHED, i));
    for (const L of lessons) await seenCompleted(userId, L.lessonId, L.revisionId);
    const trig = await makeActivity(lessons[6].revisionId, 1, []); // direct-trigger the LAST lesson
    await signal(userId, subjectId, g, 'WEAK_SKILL');
    await rmSignal(userId, subjectId, g, [trig]);

    const c1 = group((await get(token, subjectId)).body, g)!.candidates.map((c: { lesson: { id: string } }) => c.lesson.id);
    expect(c1).toHaveLength(7); // no cap
    expect(c1[0]).toBe(lessons[6].lessonId); // direct-trigger first despite highest sortOrder
    expect(c1.slice(1)).toEqual([0, 1, 2, 3, 4, 5].map((i) => lessons[i].lessonId)); // then hierarchy order
    const c2 = group((await get(token, subjectId)).body, g)!.candidates.map((c: { lesson: { id: string } }) => c.lesson.id);
    expect(c2).toEqual(c1); // deterministic
  });

  it('§73/§74/§75 IDOR + no raw evidence leak + side-effect boundary + 401', async () => {
    const { token, userId } = await makeLearner('+998900003010');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, 'A', [g]);
    const x = await makeActivity(A.revisionId, 1, [g]);
    await seenCompleted(userId, A.lessonId, A.revisionId);
    await rmSignal(userId, subjectId, g, [x]);

    const before = {
      signals: await prisma.learnerSignal.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(),
      roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count(), progress: await prisma.learnerLessonProgress.count(),
      completions: await prisma.learnerLessonCompletion.count(), attempts: await prisma.activityAttempt.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count(),
    };
    const res = await get(token, subjectId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/evidenceRefs|triggerAttemptIds|triggerActivityIds|answerKey|correctOptionIds|dueAt|basisLastMeasurementAt|payload/);

    const after = {
      signals: await prisma.learnerSignal.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(),
      roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count(), progress: await prisma.learnerLessonProgress.count(),
      completions: await prisma.learnerLessonCompletion.count(), attempts: await prisma.activityAttempt.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count(),
    };
    expect(after).toEqual(before); // §75 zero writes

    const attacker = await makeLearner('+998900003011');
    expect((await get(attacker.token, subjectId)).body.groups).toEqual([]); // never sees victim's exposure/signals
    expect((await request(server()).get(`/api/review-candidates/me/subjects/${subjectId}`)).status).toBe(401);
    expect((await request(server()).get(`/api/review-candidates/me/subjects/not-a-uuid`).set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});
