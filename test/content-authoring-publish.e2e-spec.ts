import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ContainerStatus, LessonProgressStatus, LessonStatus, MediaModerationStatus, MediaProcessingStatus, RevisionStatus, SkillStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { ContentAuditRepository } from '../src/content-authoring/content-audit.repository';
import { RoadmapRepository } from '../src/roadmap/roadmap.repository';
import { LessonExecutionRepository } from '../src/lesson-execution/lesson-execution.repository';
import { LessonExecutionService } from '../src/lesson-execution/lesson-execution.service';
import { LessonCompletionService } from '../src/lesson-execution/completion/lesson-completion.service';
import { ReviewSessionService } from '../src/review-session/review-session.service';
import {
  LessonNotExecutableError,
  LessonNotReadyForCompletionError,
  ReviewCandidateNotAvailableError,
  ReviewSessionActivityNotAvailableError,
  ReviewSessionNotFoundError,
} from '../src/common/errors';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../src/lesson-execution/activity/objective-activity-payload';
import { LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION } from '../src/content/activity/media-activity-payload';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';
const SECRET = 'SECRET-KEY-a'; // used only where a value must NEVER surface (answerKey / storageKey), not as visible option text
const obj = () => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
const media = () => ({ schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION });

describe('Content authoring — review + publication + visibility (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  let auditRepo: ContentAuditRepository;
  let roadmapRepo: RoadmapRepository;
  let execRepo: LessonExecutionRepository;
  let execService: LessonExecutionService;
  let completionService: LessonCompletionService;
  let reviewSessionService: ReviewSessionService;
  const sms = new TestSmsAdapter();
  let n = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    authz = moduleRef.get(AuthorizationRepository);
    auditRepo = moduleRef.get(ContentAuditRepository);
    roadmapRepo = moduleRef.get(RoadmapRepository);
    execRepo = moduleRef.get(LessonExecutionRepository);
    execService = moduleRef.get(LessonExecutionService);
    completionService = moduleRef.get(LessonCompletionService);
    reviewSessionService = moduleRef.get(ReviewSessionService);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.staffAudit.deleteMany();
    // takedown/review specs create attempts + review sessions (RESTRICT to activity/revision) — clear child rows first
    await prisma.skillMeasurement.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.learnerLessonCompletion.deleteMany();
    await prisma.learnerLessonProgress.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.activityMedia.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(4000000 + n++).slice(-7)}`;
  const uid = () => `${Date.now()}-${n++}`;
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);

  async function makeUser() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function grantRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  const makeAdmin = async () => { const u = await makeUser(); await grantRole(u.userId, 'ADMIN'); return u; };
  async function makeAuthorOnly(subjectId: string) {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: 'AUTHOR_ONLY_TEST' }, update: {}, create: { code: 'AUTHOR_ONLY_TEST', name: 'AuthorOnly' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: 'content.author' }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    await prisma.subjectAssignment.create({ data: { userId: u.userId, subjectId, assignedBy: u.userId } });
    return u;
  }

  async function seedChain(admin: { token: string }) {
    const subject = (await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'S' })).body;
    const track = (await P(`${BASE}/subjects/${subject.id}/tracks`, admin.token, { slug: `t-${uid()}`, title: 'T' })).body;
    const level = (await P(`${BASE}/tracks/${track.id}/levels`, admin.token, { code: 'A1', title: 'L', sortOrder: 0 })).body;
    const mod = (await P(`${BASE}/levels/${level.id}/modules`, admin.token, { title: 'M', sortOrder: 0 })).body;
    const topic = (await P(`${BASE}/modules/${mod.id}/topics`, admin.token, { title: 'Tp', sortOrder: 0 })).body;
    return { subject, track, level, mod, topic };
  }
  async function publishChain(token: string, c: Awaited<ReturnType<typeof seedChain>>) {
    await P(`${BASE}/subjects/${c.subject.id}/publish`, token, { expectedUpdatedAt: c.subject.updatedAt }).expect(201);
    await P(`${BASE}/tracks/${c.track.id}/publish`, token, { expectedUpdatedAt: c.track.updatedAt }).expect(201);
    await P(`${BASE}/levels/${c.level.id}/publish`, token, { expectedUpdatedAt: c.level.updatedAt }).expect(201);
    await P(`${BASE}/modules/${c.mod.id}/publish`, token, { expectedUpdatedAt: c.mod.updatedAt }).expect(201);
    await P(`${BASE}/topics/${c.topic.id}/publish`, token, { expectedUpdatedAt: c.topic.updatedAt }).expect(201);
  }
  const mkLesson = async (token: string, topicId: string, so = 0) => (await P(`${BASE}/topics/${topicId}/lessons`, token, { contentKey: `ck-${uid()}`, sortOrder: so })).body;
  const mkRevision = async (token: string, lessonId: string) => (await P(`${BASE}/lessons/${lessonId}/revisions`, token, { title: 'R' })).body;
  const addObj = async (token: string, revId: string, revToken: string, position = 0) => (await P(`${BASE}/revisions/${revId}/activities`, token, { type: 'MINI_QUESTION', position, payload: obj(), expectedRevisionUpdatedAt: revToken })).body;

  /** Author + review a revision with one valid objective activity; returns the REVIEW-state revision token + ids. */
  async function reviewReadyRevision(admin: { token: string }, topicId: string, lessonSort = 0) {
    const lesson = await mkLesson(admin.token, topicId, lessonSort);
    const rev = await mkRevision(admin.token, lesson.id);
    const act = await addObj(admin.token, rev.id, rev.updatedAt);
    const submitted = (await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: act.revisionUpdatedAt })).body;
    const freshLesson = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    return { lessonId: lesson.id, revisionId: rev.id, revToken: submitted.updatedAt, lessonToken: freshLesson!.updatedAt.toISOString() };
  }

  /** Publish a lesson carrying one OBJECTIVE (MINI_QUESTION) + one VIEW-ONLY (TEXT) activity; returns their ids. */
  async function publishLessonWithObjAndText(admin: { token: string }, topicId: string, sort = 0) {
    const lesson = await mkLesson(admin.token, topicId, sort);
    const rev = await mkRevision(admin.token, lesson.id);
    const a0 = await addObj(admin.token, rev.id, rev.updatedAt, 0); // MINI_QUESTION @ 0
    const text = (await P(`${BASE}/revisions/${rev.id}/activities`, admin.token, { type: 'TEXT', position: 1, payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: 'hello' }, expectedRevisionUpdatedAt: a0.revisionUpdatedAt })).body;
    const sub = (await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: text.revisionUpdatedAt })).body;
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: lesson.id } }))!.updatedAt.toISOString();
    await P(`${BASE}/revisions/${rev.id}/publish`, admin.token, { expectedRevisionUpdatedAt: sub.updatedAt, expectedLessonUpdatedAt: lessonTok }).expect(201);
    const objAct = await prisma.activity.findFirst({ where: { lessonRevisionId: rev.id, type: 'MINI_QUESTION' } });
    return { lessonId: lesson.id, revisionId: rev.id, objActivityId: objAct!.id, textActivityId: text.activity.id as string };
  }

  // ── Hierarchy publish (PB) ──
  it('PB-01/02/03 top-down hierarchy publish; child before parent → 409', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin);
    // PB-02 track before subject
    expect((await P(`${BASE}/tracks/${c.track.id}/publish`, admin.token, { expectedUpdatedAt: c.track.updatedAt })).status).toBe(409);
    // PB-01/03 full top-down
    const subj = await P(`${BASE}/subjects/${c.subject.id}/publish`, admin.token, { expectedUpdatedAt: c.subject.updatedAt });
    expect(subj.status).toBe(201);
    expect(subj.body.status).toBe(ContainerStatus.PUBLISHED);
    await P(`${BASE}/tracks/${c.track.id}/publish`, admin.token, { expectedUpdatedAt: c.track.updatedAt }).expect(201);
    await P(`${BASE}/levels/${c.level.id}/publish`, admin.token, { expectedUpdatedAt: c.level.updatedAt }).expect(201);
    await P(`${BASE}/modules/${c.mod.id}/publish`, admin.token, { expectedUpdatedAt: c.mod.updatedAt }).expect(201);
    await P(`${BASE}/topics/${c.topic.id}/publish`, admin.token, { expectedUpdatedAt: c.topic.updatedAt }).expect(201);
    expect((await prisma.subject.findUnique({ where: { id: c.subject.id } }))!.status).toBe(ContainerStatus.PUBLISHED);
  });

  it('PB-04 stale hierarchy token → 409, unchanged, no audit', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin);
    await P(`${BASE}/subjects/${c.subject.id}/publish`, admin.token, { expectedUpdatedAt: c.subject.updatedAt }).expect(201);
    const stale = await P(`${BASE}/subjects/${c.subject.id}/publish`, admin.token, { expectedUpdatedAt: c.subject.updatedAt });
    expect(stale.status).toBe(409); // already published + stale token
  });

  it('PB-05/06/07 content.author w/o publish → 403; content.publish w/o assignment → 404 (no ADMIN bypass)', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin);
    const authorOnly = await makeAuthorOnly(c.subject.id);
    expect((await P(`${BASE}/subjects/${c.subject.id}/publish`, authorOnly.token, { expectedUpdatedAt: c.subject.updatedAt })).status).toBe(403);
    const otherAdmin = await makeAdmin(); // has content.publish but NOT assigned to this subject
    expect((await P(`${BASE}/subjects/${c.subject.id}/publish`, otherAdmin.token, { expectedUpdatedAt: c.subject.updatedAt })).status).toBe(404);
  });

  // ── Review workflow (RW) ──
  it('RW-01/02/03/05 submit-review DRAFT→REVIEW; stale 409; empty→409; REVIEW frozen', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    // RW-03 empty revision cannot enter REVIEW
    expect((await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: rev.updatedAt })).body.code).toBe('CONTENT_REVIEW_NOT_READY');
    const act = await addObj(admin.token, rev.id, rev.updatedAt);
    // RW-02 stale token
    expect((await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: rev.updatedAt })).status).toBe(409);
    // RW-01 valid
    const ok = await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: act.revisionUpdatedAt });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe(RevisionStatus.REVIEW);
    // RW-05 REVIEW frozen — activity create rejected
    expect((await P(`${BASE}/revisions/${rev.id}/activities`, admin.token, { type: 'TEXT', position: 1, payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: 'x' }, expectedRevisionUpdatedAt: ok.body.updatedAt })).status).toBe(409);
  });

  it('RW-04 malformed activity blocks review (no payload leak)', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    await prisma.activity.create({ data: { lessonRevisionId: rev.id, type: 'MINI_QUESTION', position: 0, payload: { schemaVersion: 'x', answerKey: SECRET }, source: 'HUMAN' } });
    const fresh = await prisma.lessonRevision.findUnique({ where: { id: rev.id } });
    const res = await P(`${BASE}/revisions/${rev.id}/submit-review`, admin.token, { expectedUpdatedAt: fresh!.updatedAt.toISOString() });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/answerKey|SECRET|schema_version/i);
  });

  it('RW-06/07/08 return-to-draft needs content.publish + mandatory reason (audited)', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const { revisionId } = await reviewReadyRevision(admin, c.topic.id);
    const fresh = () => prisma.lessonRevision.findUnique({ where: { id: revisionId } });
    // RW-06 author-only cannot return-to-draft
    const authorOnly = await makeAuthorOnly(c.subject.id);
    expect((await P(`${BASE}/revisions/${revisionId}/return-to-draft`, authorOnly.token, { expectedUpdatedAt: (await fresh())!.updatedAt.toISOString(), reason: 'no' })).status).toBe(403);
    // RW-07 reason mandatory
    expect((await P(`${BASE}/revisions/${revisionId}/return-to-draft`, admin.token, { expectedUpdatedAt: (await fresh())!.updatedAt.toISOString() })).status).toBe(400);
    // RW-08 valid return + reason audited
    const ok = await P(`${BASE}/revisions/${revisionId}/return-to-draft`, admin.token, { expectedUpdatedAt: (await fresh())!.updatedAt.toISOString(), reason: 'needs work' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe(RevisionStatus.DRAFT);
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.revision.return_draft', targetId: revisionId } });
    expect(audit!.reason).toBe('needs work');
  });

  // ── Publication (PUB) ──
  it('PUB-01/09-self-publish first publication stamps pointer + reviewedBy/publishedBy/publishedAt', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const { lessonId, revisionId, revToken, lessonToken } = await reviewReadyRevision(admin, c.topic.id);
    const res = await P(`${BASE}/revisions/${revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: revToken, expectedLessonUpdatedAt: lessonToken });
    expect(res.status).toBe(201);
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    const rev = await prisma.lessonRevision.findUnique({ where: { id: revisionId } });
    expect(lesson!.status).toBe(LessonStatus.PUBLISHED);
    expect(lesson!.publishedRevisionId).toBe(revisionId);
    expect(rev!.status).toBe(RevisionStatus.PUBLISHED);
    expect(rev!.reviewedBy).toBe(admin.userId);
    expect(rev!.publishedBy).toBe(admin.userId);
    expect(rev!.publishedAt).not.toBeNull();
  });

  it('PUB-02 direct DRAFT→PUBLISHED rejected', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    await addObj(admin.token, rev.id, rev.updatedAt);
    const fresh = await prisma.lessonRevision.findUnique({ where: { id: rev.id } });
    const res = await P(`${BASE}/revisions/${rev.id}/publish`, admin.token, { expectedRevisionUpdatedAt: fresh!.updatedAt.toISOString(), expectedLessonUpdatedAt: (await prisma.lesson.findUnique({ where: { id: lesson.id } }))!.updatedAt.toISOString() });
    expect(res.status).toBe(409); // still DRAFT (not REVIEW)
  });

  it('PUB-03/04/05 replacement: old→ARCHIVED, new current; old pinned learner keeps v1; pointer=v2', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken }).expect(201);
    // learner pins v1
    const learner = await makeUser();
    await prisma.learnerLessonProgress.create({ data: { userId: learner.userId, lessonId: v1.lessonId, lessonRevisionId: v1.revisionId, status: LessonProgressStatus.IN_PROGRESS } });
    // author v2 on the same lesson, review + publish
    const rev2 = await mkRevision(admin.token, v1.lessonId);
    const act2 = await addObj(admin.token, rev2.id, rev2.updatedAt);
    const sub2 = (await P(`${BASE}/revisions/${rev2.id}/submit-review`, admin.token, { expectedUpdatedAt: act2.revisionUpdatedAt })).body;
    const lessonTok2 = (await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString();
    await P(`${BASE}/revisions/${rev2.id}/publish`, admin.token, { expectedRevisionUpdatedAt: sub2.updatedAt, expectedLessonUpdatedAt: lessonTok2 }).expect(201);
    const lesson = await prisma.lesson.findUnique({ where: { id: v1.lessonId } });
    expect(lesson!.publishedRevisionId).toBe(rev2.id); // PUB-05 current = v2
    expect((await prisma.lessonRevision.findUnique({ where: { id: v1.revisionId } }))!.status).toBe(RevisionStatus.ARCHIVED); // PUB-03 old archived
    expect((await prisma.lessonRevision.findUnique({ where: { id: rev2.id } }))!.status).toBe(RevisionStatus.PUBLISHED);
    // PUB-04 old pinned learner still pinned to v1
    expect((await prisma.learnerLessonProgress.findFirst({ where: { userId: learner.userId, lessonId: v1.lessonId } }))!.lessonRevisionId).toBe(v1.revisionId);
    // exactly one PUBLISHED revision for the lesson
    expect(await prisma.lessonRevision.count({ where: { lessonId: v1.lessonId, status: RevisionStatus.PUBLISHED } })).toBe(1);
  });

  it('PUB-06 idempotent republish of the already-current revision → success no-op, no extra audit, even with stale tokens', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken }).expect(201);
    const lessonAfter = await prisma.lesson.findUnique({ where: { id: v1.lessonId } });
    const auditsBefore = await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } });
    // replay with the ORIGINAL (now stale) tokens → still success no-op
    const replay = await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken });
    expect(replay.status).toBe(201);
    expect((await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString()).toBe(lessonAfter!.updatedAt.toISOString()); // unchanged
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } })).toBe(auditsBefore); // no extra audit
  });

  it('PUB-08 ARCHIVED lesson cannot publish a revision', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken }).expect(201);
    // author v2 to REVIEW on the PUBLISHED lesson BEFORE takedown (revision-create rejects ARCHIVED lessons)
    const rev2 = await mkRevision(admin.token, v1.lessonId);
    const a2 = await addObj(admin.token, rev2.id, rev2.updatedAt);
    const sub2 = (await P(`${BASE}/revisions/${rev2.id}/submit-review`, admin.token, { expectedUpdatedAt: a2.revisionUpdatedAt })).body;
    // urgent takedown, then attempt to publish v2 onto the archived lesson
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString();
    await P(`${BASE}/lessons/${v1.lessonId}/archive`, admin.token, { expectedLessonUpdatedAt: lessonTok, reason: 'takedown' }).expect(201);
    const lessonTok2 = (await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString();
    expect((await P(`${BASE}/revisions/${rev2.id}/publish`, admin.token, { expectedRevisionUpdatedAt: sub2.updatedAt, expectedLessonUpdatedAt: lessonTok2 })).body.code).toBe('CONTENT_LIFECYCLE_CONFLICT');
  });

  it('PUB-09 corrupt foreign publishedRevision pointer fails publish safely + hides the lesson', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const A = await reviewReadyRevision(admin, c.topic.id, 0);
    await P(`${BASE}/revisions/${A.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: A.revToken, expectedLessonUpdatedAt: A.lessonToken }).expect(201);
    const B = await reviewReadyRevision(admin, c.topic.id, 1);
    await P(`${BASE}/revisions/${B.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: B.revToken, expectedLessonUpdatedAt: B.lessonToken }).expect(201);
    // corrupt: point lesson A at a (non-pointer) DRAFT revision of lesson B — a foreign revision (published_revision_id is unique)
    const bExtra = await mkRevision(admin.token, B.lessonId);
    await prisma.lesson.update({ where: { id: A.lessonId }, data: { publishedRevisionId: bExtra.id } });
    // visibility denied (pointer references another lesson's revision)
    expect(await execRepo.publishedRevisionId(A.lessonId)).toBeNull();
    // a new publication attempt on lesson A fails safe on the incoherent pointer
    const C = await mkRevision(admin.token, A.lessonId);
    const c2 = await addObj(admin.token, C.id, C.updatedAt);
    const subC = (await P(`${BASE}/revisions/${C.id}/submit-review`, admin.token, { expectedUpdatedAt: c2.revisionUpdatedAt })).body;
    const lessonTokA = (await prisma.lesson.findUnique({ where: { id: A.lessonId } }))!.updatedAt.toISOString();
    const res = await P(`${BASE}/revisions/${C.id}/publish`, admin.token, { expectedRevisionUpdatedAt: subC.updatedAt, expectedLessonUpdatedAt: lessonTokA });
    expect(res.status).toBe(409); // fails safe on the incoherent pointer (caught by readiness or the archive-old coherence check)
    expect(['CONTENT_PUBLISH_NOT_READY', 'CONTENT_PUBLICATION_STATE_INVALID']).toContain(res.body.code);
  });

  it('PUB-10 audit failure rolls the whole publication back', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    const spy = jest.spyOn(auditRepo, 'write').mockRejectedValueOnce(new Error('audit boom'));
    const res = await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken });
    expect(res.status).toBe(500);
    spy.mockRestore();
    expect((await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.status).toBe(LessonStatus.DRAFT); // rolled back
    expect((await prisma.lessonRevision.findUnique({ where: { id: v1.revisionId } }))!.status).toBe(RevisionStatus.REVIEW);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } })).toBe(0);
  });

  it('CONCURRENT-PUBLISH two REVIEW revisions with the same Lesson token → exactly one publishes', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const mk = async () => { const r = await mkRevision(admin.token, lesson.id); const a = await addObj(admin.token, r.id, r.updatedAt); const s = (await P(`${BASE}/revisions/${r.id}/submit-review`, admin.token, { expectedUpdatedAt: a.revisionUpdatedAt })).body; return { id: r.id, token: s.updatedAt }; };
    const A = await mk(); const B = await mk();
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: lesson.id } }))!.updatedAt.toISOString();
    const [r1, r2] = await Promise.all([
      P(`${BASE}/revisions/${A.id}/publish`, admin.token, { expectedRevisionUpdatedAt: A.token, expectedLessonUpdatedAt: lessonTok }),
      P(`${BASE}/revisions/${B.id}/publish`, admin.token, { expectedRevisionUpdatedAt: B.token, expectedLessonUpdatedAt: lessonTok }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]); // PUB-07 loser conflict
    expect(await prisma.lessonRevision.count({ where: { lessonId: lesson.id, status: RevisionStatus.PUBLISHED } })).toBe(1);
    const published = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    expect([A.id, B.id]).toContain(published!.publishedRevisionId);
  });

  // ── Readiness (RD) + media (MR) ──
  it('RD-06/07/08/09/10/11 publish readiness: parent DRAFT / prerequisite / skill / warnings', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); // NOT published yet
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    await addObj(admin.token, rev.id, rev.updatedAt);
    // RD-06 parent hierarchy DRAFT → publishReady false, PARENT_NOT_PUBLISHED
    let rd = (await G(`${BASE}/revisions/${rev.id}/readiness`, admin.token)).body;
    expect(rd.reviewReady).toBe(true);
    expect(rd.publishReady).toBe(false);
    expect(rd.blockers.some((b: { code: string }) => b.code === 'PARENT_NOT_PUBLISHED')).toBe(true);
    // RD-09 no lesson skill → warning
    expect(rd.warnings.some((w: { code: string }) => w.code === 'NO_LESSON_SKILL')).toBe(true);
    // RD-11 duration incomplete → warning (activity has null duration)
    expect(rd.warnings.some((w: { code: string }) => w.code === 'DURATION_INCOMPLETE')).toBe(true);
    // publish hierarchy → publishReady true
    await publishChain(admin.token, c);
    rd = (await G(`${BASE}/revisions/${rev.id}/readiness`, admin.token)).body;
    expect(rd.publishReady).toBe(true);
    // RD-07 DRAFT prerequisite target → publish blocker
    const other = await mkLesson(admin.token, c.topic.id, 1); // DRAFT lesson
    const lt = (await prisma.lesson.findUnique({ where: { id: lesson.id } }))!.updatedAt.toISOString();
    await P(`${BASE}/lessons/${lesson.id}/prerequisites`, admin.token, { prerequisiteLessonId: other.id, expectedLessonUpdatedAt: lt }).expect(201);
    rd = (await G(`${BASE}/revisions/${rev.id}/readiness`, admin.token)).body;
    expect(rd.blockers.some((b: { code: string }) => b.code === 'PREREQUISITE_NOT_PUBLISHED')).toBe(true);
    // RD-10 archived mapped skill → blocker
    const skill = (await P(`${BASE}/subjects/${c.subject.id}/skills`, admin.token, { name: `Sk-${uid()}` })).body;
    await prisma.skill.update({ where: { id: skill.id }, data: { status: SkillStatus.ARCHIVED } });
    await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skill.id } });
    rd = (await G(`${BASE}/revisions/${rev.id}/readiness`, admin.token)).body;
    expect(rd.blockers.some((b: { code: string }) => b.code === 'LESSON_SKILL_ARCHIVED')).toBe(true);
  });

  it('MR-01/02/04/05/07/08 media readiness; storageKey never in readiness body', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    const img = (await P(`${BASE}/revisions/${rev.id}/activities`, admin.token, { type: 'IMAGE', position: 0, payload: media(), estimatedDurationMin: 1, expectedRevisionUpdatedAt: rev.updatedAt })).body.activity;
    const rdCode = async () => (await G(`${BASE}/revisions/${rev.id}/readiness`, admin.token)).body;
    // MR-01 no media
    expect((await rdCode()).blockers.some((b: { code: string }) => b.code === 'MEDIA_MISSING')).toBe(true);
    const asset = async (proc: MediaProcessingStatus, mod: MediaModerationStatus, mime: string) =>
      prisma.mediaAsset.create({ data: { storageKey: `key-${uid()}-STORAGE`, mimeType: mime, sizeBytes: 1, uploadedBy: admin.userId, processingStatus: proc, moderationStatus: mod } });
    const link = async (assetId: string) => prisma.activityMedia.create({ data: { activityId: img.id, mediaAssetId: assetId, position: 0 } });
    // MR-02 pending
    const a1 = await asset(MediaProcessingStatus.PENDING, MediaModerationStatus.APPROVED, 'image/png'); await link(a1.id);
    expect((await rdCode()).blockers.some((b: { code: string }) => b.code === 'MEDIA_NOT_READY')).toBe(true);
    await prisma.activityMedia.deleteMany({ where: { activityId: img.id } });
    // MR-04 blocked
    const a2 = await asset(MediaProcessingStatus.READY, MediaModerationStatus.BLOCKED, 'image/png'); await link(a2.id);
    expect((await rdCode()).blockers.some((b: { code: string }) => b.code === 'MEDIA_BLOCKED')).toBe(true);
    await prisma.activityMedia.deleteMany({ where: { activityId: img.id } });
    // MR-05 mime mismatch (image activity, audio asset)
    const a3 = await asset(MediaProcessingStatus.READY, MediaModerationStatus.APPROVED, 'audio/mpeg'); await link(a3.id);
    expect((await rdCode()).blockers.some((b: { code: string }) => b.code === 'MEDIA_MIME_MISMATCH')).toBe(true);
    await prisma.activityMedia.deleteMany({ where: { activityId: img.id } });
    // MR-07 ready + unreviewed + match → publish-ready + warning
    const a4 = await asset(MediaProcessingStatus.READY, MediaModerationStatus.UNREVIEWED, 'image/jpeg'); await link(a4.id);
    let rd = await rdCode();
    expect(rd.publishReady).toBe(true);
    expect(rd.warnings.some((w: { code: string }) => w.code === 'MEDIA_UNREVIEWED')).toBe(true);
    // MR-08 ready + approved + match → clean
    await prisma.mediaAsset.update({ where: { id: a4.id }, data: { moderationStatus: MediaModerationStatus.APPROVED } });
    rd = await rdCode();
    expect(rd.publishReady).toBe(true);
    expect(rd.warnings.some((w: { code: string }) => w.code === 'MEDIA_UNREVIEWED')).toBe(false);
    // storageKey never leaks
    expect(JSON.stringify(rd)).not.toMatch(/STORAGE|storageKey/);
  });

  // ── Preview (PV) ──
  it('PV-01/02/03/09 staff preview: allowed with scope; out-of-scope 404; strips answerKey; no storageKey', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const lesson = await mkLesson(admin.token, c.topic.id);
    const rev = await mkRevision(admin.token, lesson.id);
    await addObj(admin.token, rev.id, rev.updatedAt);
    const prev = await G(`${BASE}/revisions/${rev.id}/preview`, admin.token);
    expect(prev.status).toBe(200);
    const objAct = prev.body.activities.find((a: { format?: string }) => a.format);
    expect(objAct).toMatchObject({ type: 'MINI_QUESTION', format: 'single_choice', prompt: 'Q' });
    const json = JSON.stringify(prev.body);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain(SECRET);
    // PV-02 out-of-scope
    const other = await makeAdmin();
    expect((await G(`${BASE}/revisions/${rev.id}/preview`, other.token)).status).toBe(404);
  });

  // ── Central visibility + takedown (VIS / §53) ──
  it('VIS/§53 publish makes the lesson roadmap-eligible; takedown blocks access without deleting history', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken }).expect(201);
    // roadmap eligibility true; new start resolves current revision; resume gate open
    expect((await roadmapRepo.lessonMeta([v1.lessonId])).get(v1.lessonId)!.eligible).toBe(true);
    expect(await execRepo.publishedRevisionId(v1.lessonId)).toBe(v1.revisionId);
    expect(await execRepo.isLessonResumable(v1.lessonId)).toBe(true);
    // pin a learner + a completion (history)
    const learner = await makeUser();
    await prisma.learnerLessonProgress.create({ data: { userId: learner.userId, lessonId: v1.lessonId, lessonRevisionId: v1.revisionId, status: LessonProgressStatus.IN_PROGRESS } });
    await prisma.learnerLessonCompletion.create({ data: { userId: learner.userId, lessonId: v1.lessonId, lessonRevisionId: v1.revisionId, completionNo: 1 } });
    // urgent takedown
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString();
    const arch = await P(`${BASE}/lessons/${v1.lessonId}/archive`, admin.token, { expectedLessonUpdatedAt: lessonTok, reason: 'safety' });
    expect(arch.status).toBe(201);
    // access removed
    expect((await roadmapRepo.lessonMeta([v1.lessonId])).get(v1.lessonId)!.eligible).toBe(false);
    expect(await execRepo.publishedRevisionId(v1.lessonId)).toBeNull();
    expect(await execRepo.isLessonResumable(v1.lessonId)).toBe(false);
    // history + pointer intact; only the Lesson is archived
    const lesson = await prisma.lesson.findUnique({ where: { id: v1.lessonId } });
    expect(lesson!.status).toBe(LessonStatus.ARCHIVED);
    expect(lesson!.publishedRevisionId).toBe(v1.revisionId); // pointer unchanged
    expect((await prisma.lessonRevision.findUnique({ where: { id: v1.revisionId } }))!.status).toBe(RevisionStatus.PUBLISHED); // revision unchanged
    expect(await prisma.learnerLessonProgress.count({ where: { lessonId: v1.lessonId } })).toBe(1);
    expect(await prisma.learnerLessonCompletion.count({ where: { lessonId: v1.lessonId } })).toBe(1);
    expect((await prisma.staffAudit.findFirst({ where: { actionCode: 'content.lesson.archive', targetId: v1.lessonId } }))!.reason).toBe('safety');
  });

  // ── Blocker A: urgent takedown fully removes learner EXECUTION access (TD) ──
  it('TD-01..07 takedown denies objective attempt / view-only / completion; open before, closed after; history intact', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const L = await publishLessonWithObjAndText(admin, c.topic.id);
    const learner = await makeUser();
    await prisma.learnerLessonProgress.create({ data: { userId: learner.userId, lessonId: L.lessonId, lessonRevisionId: L.revisionId, status: LessonProgressStatus.IN_PROGRESS } });

    // TD-01/02 BEFORE takedown: both execution surfaces are open (PUBLISHED lesson + hierarchy)
    await execService.submitActivityAttempt(learner.userId, L.lessonId, L.objActivityId, uid(), { selectedOptionId: 'a' });
    expect(await prisma.activityAttempt.count({ where: { userId: learner.userId, activityId: L.objActivityId, reviewSessionId: null } })).toBe(1);
    expect((await completionService.markViewOnlyStep(learner.userId, L.lessonId, L.textActivityId)).recorded).toBe(true);

    // urgent takedown → Lesson ARCHIVED
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: L.lessonId } }))!.updatedAt.toISOString();
    await P(`${BASE}/lessons/${L.lessonId}/archive`, admin.token, { expectedLessonUpdatedAt: lessonTok, reason: 'takedown' }).expect(201);

    // TD-03 objective attempt denied BEFORE any replay/create/signal
    await expect(execService.submitActivityAttempt(learner.userId, L.lessonId, L.objActivityId, uid(), { selectedOptionId: 'a' })).rejects.toBeInstanceOf(LessonNotExecutableError);
    // TD-04 view-only step denied
    await expect(completionService.markViewOnlyStep(learner.userId, L.lessonId, L.textActivityId)).rejects.toBeInstanceOf(LessonNotReadyForCompletionError);
    // TD-05 lesson completion denied
    await expect(completionService.completeLesson(learner.userId, L.lessonId)).rejects.toBeInstanceOf(LessonNotReadyForCompletionError);

    // TD-06/07 history intact — nothing deleted / repinned; pointer + revision + the pre-takedown attempt survive
    const prog = await prisma.learnerLessonProgress.findFirst({ where: { userId: learner.userId, lessonId: L.lessonId } });
    expect(prog!.status).toBe(LessonProgressStatus.IN_PROGRESS);
    expect(prog!.lessonRevisionId).toBe(L.revisionId);
    expect(await prisma.activityAttempt.count({ where: { userId: learner.userId, activityId: L.objActivityId } })).toBe(1);
    expect((await prisma.lesson.findUnique({ where: { id: L.lessonId } }))!.publishedRevisionId).toBe(L.revisionId);
    expect((await prisma.lessonRevision.findUnique({ where: { id: L.revisionId } }))!.status).toBe(RevisionStatus.PUBLISHED);
  });

  // ── Blocker A: urgent takedown removes REVIEW-SESSION access without leaking hidden content (RS-TD) ──
  it('RS-TD-01..03 takedown blocks getSession/submitAttempt/complete on an existing review session; open before', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const L = await publishLessonWithObjAndText(admin, c.topic.id);
    const learner = await makeUser();
    const skill = (await P(`${BASE}/subjects/${c.subject.id}/skills`, admin.token, { name: `Sk-${uid()}` })).body;
    // an existing ACTIVE review session over this lesson's pinned revision (direct row — bypasses candidate gating)
    const session = await prisma.learnerReviewSession.create({
      data: { userId: learner.userId, skillId: skill.id, lessonId: L.lessonId, lessonRevisionId: L.revisionId, provenance: { schemaVersion: 'review-session-evidence/v1', signalTypes: [] } },
    });
    await prisma.learnerReviewSessionActivity.create({ data: { reviewSessionId: session.id, activityId: L.objActivityId, position: 1 } });

    // BEFORE takedown: session is usable
    expect((await reviewSessionService.getSession(learner.userId, session.id)).id).toBe(session.id);
    await reviewSessionService.submitAttempt(learner.userId, session.id, L.objActivityId, uid(), { selectedOptionId: 'a' });

    // urgent takedown
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: L.lessonId } }))!.updatedAt.toISOString();
    await P(`${BASE}/lessons/${L.lessonId}/archive`, admin.token, { expectedLessonUpdatedAt: lessonTok, reason: 'takedown' }).expect(201);

    // RS-TD-01 getSession → 404-safe (do not reveal the hidden content exists)
    await expect(reviewSessionService.getSession(learner.userId, session.id)).rejects.toBeInstanceOf(ReviewSessionNotFoundError);
    // RS-TD-02 submitAttempt denied
    await expect(reviewSessionService.submitAttempt(learner.userId, session.id, L.objActivityId, uid(), { selectedOptionId: 'a' })).rejects.toBeInstanceOf(ReviewSessionActivityNotAvailableError);
    // RS-TD-03 complete denied
    await expect(reviewSessionService.complete(learner.userId, session.id)).rejects.toBeInstanceOf(ReviewSessionActivityNotAvailableError);
    // start (or resume) a candidate for a hidden lesson is not available either
    await expect(reviewSessionService.start(learner.userId, c.subject.id, skill.id, L.lessonId)).rejects.toBeInstanceOf(ReviewCandidateNotAvailableError);

    // session + its history rows are intact (not deleted / cancelled / repinned)
    const after = await prisma.learnerReviewSession.findUnique({ where: { id: session.id } });
    expect(after!.status).toBe('ACTIVE');
    expect(after!.lessonRevisionId).toBe(L.revisionId);
    expect(await prisma.activityAttempt.count({ where: { reviewSessionId: session.id } })).toBe(1);
  });

  // ── Blocker B: idempotent republish must not silently "restore" a taken-down lesson (REP-TD) ──
  it('REP-TD-01 republish the same revision after takedown → lifecycle conflict, no restore / timestamp change / audit', async () => {
    const admin = await makeAdmin();
    const c = await seedChain(admin); await publishChain(admin.token, c);
    const v1 = await reviewReadyRevision(admin, c.topic.id);
    await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken }).expect(201);
    // urgent takedown (pointer + revision remain, only Lesson.status → ARCHIVED)
    const lessonTok = (await prisma.lesson.findUnique({ where: { id: v1.lessonId } }))!.updatedAt.toISOString();
    await P(`${BASE}/lessons/${v1.lessonId}/archive`, admin.token, { expectedLessonUpdatedAt: lessonTok, reason: 'takedown' }).expect(201);
    const archived = await prisma.lesson.findUnique({ where: { id: v1.lessonId } });
    const publishAudits = await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } });

    // republish the SAME (still-PUBLISHED) revision with the ORIGINAL tokens — must NOT be treated as an idempotent no-op
    const res = await P(`${BASE}/revisions/${v1.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: v1.revToken, expectedLessonUpdatedAt: v1.lessonToken });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_LIFECYCLE_CONFLICT');
    // lesson stays ARCHIVED, updatedAt unchanged, no publish audit written
    const now = await prisma.lesson.findUnique({ where: { id: v1.lessonId } });
    expect(now!.status).toBe(LessonStatus.ARCHIVED);
    expect(now!.updatedAt.toISOString()).toBe(archived!.updatedAt.toISOString());
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } })).toBe(publishAudits);
  });

  // ── Blocker C: same-subject prerequisite is revalidated by readiness (the final safety gate) ──
  it('PREREQ-SUBJECT direct-DB cross-subject prerequisite → readiness mismatch + publish 409; no state change / audit / foreign leak', async () => {
    const admin = await makeAdmin();
    const c1 = await seedChain(admin); await publishChain(admin.token, c1);
    const c2 = await seedChain(admin); await publishChain(admin.token, c2);
    // source lesson in subject 1 (REVIEW-ready), foreign PUBLISHED lesson in subject 2
    const source = await reviewReadyRevision(admin, c1.topic.id, 0);
    const foreign = await reviewReadyRevision(admin, c2.topic.id, 0);
    await P(`${BASE}/revisions/${foreign.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: foreign.revToken, expectedLessonUpdatedAt: foreign.lessonToken }).expect(201);
    // corruption: cross-subject prerequisite inserted directly, bypassing the same-subject authoring guard
    await prisma.lessonPrerequisite.create({ data: { lessonId: source.lessonId, prerequisiteLessonId: foreign.lessonId } });

    // readiness (final gate) revalidates same-subject → publishReady false + safe mismatch blocker, no foreign identity
    const rd = (await G(`${BASE}/revisions/${source.revisionId}/readiness`, admin.token)).body;
    expect(rd.publishReady).toBe(false);
    expect(rd.blockers.some((b: { code: string }) => b.code === 'PREREQUISITE_SUBJECT_MISMATCH')).toBe(true);
    const rdJson = JSON.stringify(rd);
    expect(rdJson).not.toContain(c2.subject.id);
    expect(rdJson).not.toContain(foreign.lessonId);

    // publish is refused (409), source revision/lesson unchanged, no publish audit
    const publishAudits = await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } });
    const res = await P(`${BASE}/revisions/${source.revisionId}/publish`, admin.token, { expectedRevisionUpdatedAt: source.revToken, expectedLessonUpdatedAt: source.lessonToken });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_PUBLISH_NOT_READY');
    expect((await prisma.lesson.findUnique({ where: { id: source.lessonId } }))!.status).toBe(LessonStatus.DRAFT);
    expect((await prisma.lessonRevision.findUnique({ where: { id: source.revisionId } }))!.status).toBe(RevisionStatus.REVIEW);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.revision.publish' } })).toBe(publishAudits);
  });
});
