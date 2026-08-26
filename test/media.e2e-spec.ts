// Local media storage for this suite (dev/test only; never production).
process.env.MEDIA_STORAGE_DRIVER = 'local';
process.env.MEDIA_LOCAL_ROOT = require('node:path').join(require('node:os').tmpdir(), `izlan-media-test-${process.pid}`);

import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { runRuntimeFixture } from '../src/bootstrap/seed-runtime';
import { RevisionService } from '../src/content-authoring/revision.service';
import { ActivityService } from '../src/content-authoring/activity.service';
import { MAX_IMAGE_BYTES } from '../src/media/media.constants';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const SEED_ENV = { nodeEnv: 'test', allowDevFixture: 'true', adminPassword: 'DemoAdmin!123', learnerPassword: 'DemoLearner!123' };
// A minimal REAL 1x1 PNG (valid signature + IHDR/IDAT/IEND) and a minimal WAV header.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from('fmt '), Buffer.alloc(20)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('Lesson media pipeline (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let n = 0;
  let admin: { token: string; userId: string };
  let learner: { token: string };
  let draftActivityId: string;
  let publishedActivityId: string;
  let draftRevisionUpdatedAt: string;
  let lessonId: string;

  const srv = () => app.getHttpServer();
  const phone = () => `+99890${String(7100000 + n++).slice(-7)}`;
  async function makeUser(role?: string) {
    const ph = phone();
    const req = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    if (role) { const r = await prisma.role.findUnique({ where: { code: role } }); await prisma.userRole.create({ data: { userId: user!.id, roleId: r!.id, grantedBy: null } }); }
    return { token: reg.body.accessToken as string, userId: user!.id };
  }
  const up = (tok: string) => request(srv()).post('/api/staff/content/media').set('Authorization', `Bearer ${tok}`);

  async function wipe() {
    await prisma.activityMedia.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.staffAudit.deleteMany();
    await cleanupRoadmapContent(prisma);
    await cleanupAssessmentTables(prisma);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
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
    await wipe();
    await bootstrapSystemRoles(authz);
    const fixture = await runRuntimeFixture({ prisma, authz, hasher: new Argon2PasswordHasher() }, SEED_ENV);

    admin = await makeUser('ADMIN');
    learner = await makeUser(); // LEARNER role by default from registration — no content.author
    // Assign the admin to the subject so authoring services accept it.
    const subjectId = fixture.subjectId;
    await mod.get(RevisionService, { strict: false }); // ensure module resolved
    await request(srv()).post(`/api/staff/content/subjects/${subjectId}/assignments`).set('Authorization', `Bearer ${admin.token}`).send({ userId: admin.userId });

    // A DRAFT activity to attach media to (new revision on the seeded published lesson L1).
    lessonId = fixture.lessonIds[0];
    const rev = await mod.get(RevisionService, { strict: false }).createRevision(admin.userId, lessonId, { title: 'draft for media' });
    const created = await mod.get(ActivityService, { strict: false }).createActivity(admin.userId, rev.id, { expectedRevisionUpdatedAt: rev.updatedAt, type: 'EXPLANATION', position: 0, payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: 'Body' } });
    draftActivityId = created.activity.id;
    draftRevisionUpdatedAt = created.revisionUpdatedAt;
    // A PUBLISHED activity (from the seeded published revision) — attaching to it must be denied.
    publishedActivityId = (await prisma.activity.findFirstOrThrow({ where: { revision: { lessonId, status: 'PUBLISHED' } } })).id;
  }, 120_000);

  afterAll(async () => {
    await wipe();
    await app.close();
    await rm(process.env.MEDIA_LOCAL_ROOT!, { recursive: true, force: true });
  });

  // ── Upload ──
  it('MEDIA-01 rejects unauthenticated upload (401) and a non-author role (403)', async () => {
    await request(srv()).post('/api/staff/content/media').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(401);
    await up(learner.token).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(403);
  });

  it('MEDIA-02 uploads a valid image → reusable asset (id/kind/mime), NO alt text on the asset, NO storageKey', async () => {
    const r = await up(admin.token).attach('file', PNG, { filename: 'pic.png', contentType: 'image/png' }).expect(201);
    expect(r.body).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(r.body.id).toBeTruthy();
    expect(r.body).not.toHaveProperty('altText'); // alt text is contextual (set at attach), not part of the asset
    expect(JSON.stringify(r.body)).not.toContain('storageKey');
    expect(JSON.stringify(r.body)).not.toContain(process.env.MEDIA_LOCAL_ROOT);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(asset.storageKey).toMatch(/^[0-9a-f-]{36}$/); // opaque uuid, not the filename
    expect(asset.processingStatus).toBe('READY');
    expect(asset).not.toHaveProperty('altText'); // the column was moved off MediaAsset entirely
  });

  it('MEDIA-03 uploads a valid audio clip', async () => {
    const r = await up(admin.token).attach('file', WAV, { filename: 'clip.wav', contentType: 'audio/wav' }).expect(201);
    expect(r.body).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' });
  });

  it('MEDIA-04 rejects an unsupported MIME (HTML) and a MIME/bytes mismatch', async () => {
    await up(admin.token).attach('file', HTML, { filename: 'x.html', contentType: 'text/html' }).expect(400);
    await up(admin.token).attach('file', HTML, { filename: 'x.png', contentType: 'image/png' }).expect(400); // magic mismatch
  });

  it('MEDIA-05 rejects an oversized image (> per-type cap) with 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    await up(admin.token).attach('file', big, { filename: 'big.png', contentType: 'image/png' }).expect(413);
  });

  // ── Attach / detach ──
  it('MEDIA-06 image attach REQUIRES alt text (on the attachment), blocks PUBLISHED, then detaches', async () => {
    const asset = (await up(admin.token).attach('file', PNG, { filename: 'd.png', contentType: 'image/png' }).expect(201)).body;

    // PUBLISHED revision activity → CONTENT_NOT_DRAFT (immutability wins before any alt check)
    const pubRev = await prisma.activity.findFirstOrThrow({ where: { id: publishedActivityId }, select: { revision: { select: { updatedAt: true } } } });
    const denied = await request(srv()).post(`/api/staff/content/activities/${publishedActivityId}/media`).set('Authorization', `Bearer ${admin.token}`).send({ expectedRevisionUpdatedAt: pubRev.revision.updatedAt.toISOString(), mediaAssetId: asset.id, altText: 'diagram' });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('CONTENT_NOT_DRAFT');

    // DRAFT image attach WITHOUT alt text → 400 MEDIA_ALT_TEXT_REQUIRED; nothing linked, token NOT consumed
    const noAlt = await request(srv()).post(`/api/staff/content/activities/${draftActivityId}/media`).set('Authorization', `Bearer ${admin.token}`).send({ expectedRevisionUpdatedAt: draftRevisionUpdatedAt, mediaAssetId: asset.id });
    expect(noAlt.status).toBe(400);
    expect(noAlt.body.code).toBe('MEDIA_ALT_TEXT_REQUIRED');
    expect(await prisma.activityMedia.count({ where: { activityId: draftActivityId, mediaAssetId: asset.id } })).toBe(0);

    // DRAFT image attach WITH alt text → 201
    const attach = await request(srv()).post(`/api/staff/content/activities/${draftActivityId}/media`).set('Authorization', `Bearer ${admin.token}`).send({ expectedRevisionUpdatedAt: draftRevisionUpdatedAt, mediaAssetId: asset.id, altText: 'diagram' }).expect(201);
    draftRevisionUpdatedAt = attach.body.revisionUpdatedAt;
    expect(await prisma.activityMedia.count({ where: { activityId: draftActivityId, mediaAssetId: asset.id } })).toBe(1);

    // alt text lives on the ATTACHMENT (ActivityMedia), not the asset
    const link = await prisma.activityMedia.findFirstOrThrow({ where: { activityId: draftActivityId, mediaAssetId: asset.id }, select: { altText: true } });
    expect(link.altText).toBe('diagram');

    // list shows the per-attachment alt text (safe fields only)
    const list = await request(srv()).get(`/api/staff/content/activities/${draftActivityId}/media`).set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect(list.body[0]).toMatchObject({ id: asset.id, kind: 'image', altText: 'diagram' });
    expect(JSON.stringify(list.body)).not.toContain('storageKey');

    // detach
    const detach = await request(srv()).delete(`/api/staff/content/activities/${draftActivityId}/media/${asset.id}`).set('Authorization', `Bearer ${admin.token}`).send({ expectedRevisionUpdatedAt: draftRevisionUpdatedAt }).expect(200);
    draftRevisionUpdatedAt = detach.body.revisionUpdatedAt;
    expect(await prisma.activityMedia.count({ where: { activityId: draftActivityId, mediaAssetId: asset.id } })).toBe(0);
    // detaching the attachment does NOT delete the reusable asset (RESTRICT on the FK; no orphan cleanup in this slice)
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  });

  // ── Download ──
  it('MEDIA-07 serves media bytes to an authenticated caller with the correct Content-Type; unknown → 404', async () => {
    const asset = (await up(admin.token).attach('file', PNG, { filename: 'g.png', contentType: 'image/png' }).expect(201)).body;
    const dl = await request(srv()).get(`/api/media/${asset.id}/content`).set('Authorization', `Bearer ${learner.token}`).expect(200);
    expect(dl.headers['content-type']).toContain('image/png');
    expect(dl.headers['content-disposition']).toBe('inline');
    expect(Buffer.from(dl.body).length).toBe(PNG.length);
    // unauthenticated → 401
    await request(srv()).get(`/api/media/${asset.id}/content`).expect(401);
    // unknown asset → 404
    await request(srv()).get('/api/media/01a00000-0000-7000-8000-000000000000/content').set('Authorization', `Bearer ${learner.token}`).expect(404);
  });

  // ── Reuse (the reason alt text lives on the attachment) ──
  it('MEDIA-08 the SAME asset attaches to two activities with DIFFERENT alt text; audio needs no alt', async () => {
    const revSvc = mod.get(RevisionService, { strict: false });
    const actSvc = mod.get(ActivityService, { strict: false });
    const md = { schemaVersion: 'lesson-activity-markdown/v1' as const, markdown: 'x' };
    const rev = await revSvc.createRevision(admin.userId, lessonId, { title: 'reuse media' });
    const a1 = await actSvc.createActivity(admin.userId, rev.id, { expectedRevisionUpdatedAt: rev.updatedAt, type: 'EXPLANATION', position: 0, payload: md });
    const a2 = await actSvc.createActivity(admin.userId, rev.id, { expectedRevisionUpdatedAt: a1.revisionUpdatedAt, type: 'EXPLANATION', position: 1, payload: md });
    let token = a2.revisionUpdatedAt;

    // ONE uploaded image asset...
    const img = (await up(admin.token).attach('file', PNG, { filename: 'r.png', contentType: 'image/png' }).expect(201)).body;
    const post = (activityId: string, body: object) =>
      request(srv()).post(`/api/staff/content/activities/${activityId}/media`).set('Authorization', `Bearer ${admin.token}`).send(body);

    // ...attached to TWO activities with different contextual alt text
    token = (await post(a1.activity.id, { expectedRevisionUpdatedAt: token, mediaAssetId: img.id, altText: 'family tree, context A' }).expect(201)).body.revisionUpdatedAt;
    token = (await post(a2.activity.id, { expectedRevisionUpdatedAt: token, mediaAssetId: img.id, altText: 'family tree, context B' }).expect(201)).body.revisionUpdatedAt;

    expect(await prisma.activityMedia.count({ where: { mediaAssetId: img.id } })).toBe(2); // one shared asset, two attachments
    const get = (activityId: string) => request(srv()).get(`/api/staff/content/activities/${activityId}/media`).set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect((await get(a1.activity.id)).body[0].altText).toBe('family tree, context A');
    expect((await get(a2.activity.id)).body[0].altText).toBe('family tree, context B');

    // audio attaches with NO alt text → altText null
    const aud = (await up(admin.token).attach('file', WAV, { filename: 'r.wav', contentType: 'audio/wav' }).expect(201)).body;
    token = (await post(a1.activity.id, { expectedRevisionUpdatedAt: token, mediaAssetId: aud.id }).expect(201)).body.revisionUpdatedAt;
    const audItem = (await get(a1.activity.id)).body.find((m: { id: string }) => m.id === aud.id);
    expect(audItem).toMatchObject({ kind: 'audio', altText: null });
  });
});
