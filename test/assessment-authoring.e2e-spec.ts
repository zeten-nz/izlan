import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, AssessmentPurposeScope, ContainerStatus, ContentSource, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { ASSESSMENT_AUTHOR } from '../src/assessment-authoring/assessment-authoring.constants';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';
import { cleanupAuthTables, cleanupAssessmentTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

describe('Assessment authoring (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let n = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const base = '/api/staff/content/assessments';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await resetAll();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(authz);
  });

  afterAll(async () => {
    await resetAll();
    await app.close();
  });
  beforeEach(async () => {
    await resetAll();
    await bootstrapSystemRoles(authz); // cleanupAuthTables wipes RolePermission — re-seed role→permission grants each test
    sms.clear();
  });

  async function resetAll() {
    await prisma.staffAudit.deleteMany(); // authoring writes audit rows (actor → user RESTRICT); clear before users
    await cleanupAssessmentTables(prisma);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }

  const srv = () => app.getHttpServer();
  const get = (t: string, p: string) => request(srv()).get(base + p).set('Authorization', `Bearer ${t}`);
  const post = (t: string, p: string, body?: object) => request(srv()).post(base + p).set('Authorization', `Bearer ${t}`).send(body ?? {});
  const patch = (t: string, p: string, body: object) => request(srv()).patch(base + p).set('Authorization', `Bearer ${t}`).send(body);
  const del = (t: string, p: string, body: object) => request(srv()).delete(base + p).set('Authorization', `Bearer ${t}`).send(body);

  // ── users / roles / scope ──
  async function makeUser(roleCode?: string): Promise<{ token: string; userId: string }> {
    const phone = `+99890${String(3200000 + n++).slice(-7)}`;
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(srv()).post('/api/auth/otp/request').send({ phone });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    if (roleCode) {
      const role = await prisma.role.findUnique({ where: { code: roleCode } });
      // registration already auto-grants LEARNER; skipDuplicates keeps a second LEARNER (or repeat) assignment idempotent
      await prisma.userRole.createMany({ data: [{ userId: user!.id, roleId: role!.id, grantedBy: null }], skipDuplicates: true });
    }
    return { token: reg.body.accessToken as string, userId: user!.id };
  }
  const assign = (userId: string, subjectId: string) => prisma.subjectAssignment.create({ data: { userId, subjectId, assignedBy: null } });

  async function makeSubject(creatorId: string, skillCount = 3): Promise<{ subjectId: string; trackId: string; skillIds: string[] }> {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const skillIds: string[] = [];
    for (let i = 0; i < skillCount; i++) skillIds.push((await prisma.skill.create({ data: { subjectId: s.id, name: `sk-${uid()}`, code: `SK-${uid()}`, status: 'ACTIVE' } })).id);
    return { subjectId: s.id, trackId: t.id, skillIds };
  }

  // Simulate the dev-provisioned "existing" diagnostic: PUBLISHED def + PUBLISHED version + pool + currentVersionId (raw Prisma, exactly like seed).
  async function seedPublishedDiagnostic(creatorId: string, subjectId: string, skillIds: string[], opts: { itemsPerSkill?: number; maxItems?: number } = {}) {
    const config = { schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION, selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 }, coverage: { itemsPerSkill: opts.itemsPerSkill ?? 1 }, stopping: { maxItems: opts.maxItems ?? 10 }, profileScale: { minDifficulty: 1, maxDifficulty: 6 } };
    const def = await prisma.assessmentDefinition.create({ data: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'English A1 Placement', status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const version = await prisma.assessmentDefinitionVersion.create({ data: { definitionId: def.id, versionNo: 1, config, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: version.id } });
    const itemIds: string[] = [];
    for (const skillId of skillIds) {
      const payload = { schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt: `Q ${uid()}`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } };
      const item = await prisma.assessmentItem.create({ data: { definitionId: def.id, type: ActivityType.MINI_QUESTION, payload, skillId, difficulty: 3, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN } });
      await prisma.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } });
      itemIds.push(item.id);
    }
    return { definitionId: def.id, versionId: version.id, itemIds };
  }

  const singleChoice = (over: Partial<{ prompt: string; skillId: string; difficulty: number; correct: string }> = {}, skillId?: string) => ({
    format: 'single_choice', prompt: over.prompt ?? 'Which is correct?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
    correctOptionIds: [over.correct ?? 'a'], skillId: over.skillId ?? skillId!, difficulty: over.difficulty ?? 3,
  });

  // Add a passing item to a draft version; returns the fresh version token.
  async function addItem(token: string, versionId: string, versionToken: string, skillId: string, over: object = {}): Promise<string> {
    const r = await post(token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: versionToken, ...singleChoice(over, skillId) }).expect(201);
    return r.body.version.updatedAt as string;
  }

  // ────────────────────────────────────────────────────────────────────────────
  describe('§26 permissions — code authority + SubjectAssignment, no role-name bypass', () => {
    it('AA-P01 unauthenticated → 401', async () => {
      const admin = await makeUser('ADMIN');
      const { subjectId } = await makeSubject(admin.userId);
      await request(srv()).get(`${base}/subjects/${subjectId}`).expect(401);
    });

    it('AA-P02 LEARNER/MODERATOR (no code) → 403', async () => {
      const admin = await makeUser('ADMIN');
      const { subjectId } = await makeSubject(admin.userId);
      const learner = await makeUser('LEARNER');
      const moderator = await makeUser('MODERATOR');
      await get(learner.token, `/subjects/${subjectId}`).expect(403);
      await get(moderator.token, `/subjects/${subjectId}`).expect(403);
    });

    it('AA-P03 METHODIST with seeded code + assignment → allowed', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      await get(meth.token, `/subjects/${subjectId}`).expect(200);
    });

    it('AA-P04 ADMIN holds the code but WITHOUT an assignment → denied (IDOR-safe 404)', async () => {
      const admin = await makeUser('ADMIN');
      const { subjectId } = await makeSubject(admin.userId);
      await get(admin.token, `/subjects/${subjectId}`).expect(404); // no SubjectAssignment → not-found, never 200
    });

    it('AA-P05 a NON-system custom role holding assessment.author + assignment → allowed (no role-name authority)', async () => {
      const role = await prisma.role.create({ data: { code: `CUST-${uid()}`, name: 'Custom' } });
      await authz.ensureRolePermissions(role.id, [ASSESSMENT_AUTHOR]);
      const u = await makeUser();
      await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
      const { subjectId } = await makeSubject(u.userId);
      await assign(u.userId, subjectId);
      await get(u.token, `/subjects/${subjectId}`).expect(200);
    });

    it('AA-P06 publish requires assessment.publish specifically (author-only cannot publish)', async () => {
      const role = await prisma.role.create({ data: { code: `AUTHONLY-${uid()}`, name: 'AuthorOnly' } });
      await authz.ensureRolePermissions(role.id, [ASSESSMENT_AUTHOR]); // author but NOT publish
      const u = await makeUser();
      await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
      const { subjectId, skillIds } = await makeSubject(u.userId);
      await assign(u.userId, subjectId);
      const seeded = await seedPublishedDiagnostic(u.userId, subjectId, skillIds);
      await post(u.token, `/versions/${seeded.versionId}/publish`, { expectedVersionUpdatedAt: new Date().toISOString() }).expect(403);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('§27 authoring — definition, versions, items, config, OCC', () => {
    it('AA-A01 open existing diagnostic; ensure is idempotent (no second DIAGNOSTIC)', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const seeded = await seedPublishedDiagnostic(meth.userId, subjectId, skillIds);
      const r = await get(meth.token, `/subjects/${subjectId}`).expect(200);
      expect(r.body.definition.id).toBe(seeded.definitionId);
      expect(r.body.definition.currentVersionId).toBe(seeded.versionId);
      const ensured = await post(meth.token, `/subjects/${subjectId}`, {}).expect(200);
      expect(ensured.body.id).toBe(seeded.definitionId); // idempotent — same row
      expect(await prisma.assessmentDefinition.count({ where: { subjectId, purposeScope: 'DIAGNOSTIC' } })).toBe(1);
    });

    it('AA-A02 create absent definition (DRAFT) + edit with OCC', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const created = await post(meth.token, `/subjects/${subjectId}`, { title: 'My placement' }).expect(200);
      expect(created.body).toMatchObject({ subjectId, purposeScope: 'DIAGNOSTIC', status: 'DRAFT', title: 'My placement', currentVersionId: null });
      // OCC: stale token rejected, correct token accepted
      await patch(meth.token, `/${created.body.id}`, { expectedUpdatedAt: new Date(Date.now() - 60_000).toISOString(), title: 'X' }).expect(409);
      const ok = await patch(meth.token, `/${created.body.id}`, { expectedUpdatedAt: created.body.updatedAt, description: 'desc' }).expect(200);
      expect(ok.body.description).toBe('desc');
    });

    it('AA-A03 blank + clone_current versions; only ONE editable version at a time', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const seeded = await seedPublishedDiagnostic(meth.userId, subjectId, skillIds);
      // clone the published current version → DRAFT v2 with copied items (NEW ids)
      const cloned = await post(meth.token, `/${seeded.definitionId}/versions`, { mode: 'clone_current' }).expect(201);
      expect(cloned.body.version.status).toBe('DRAFT');
      expect(cloned.body.items).toHaveLength(skillIds.length);
      expect(cloned.body.items.map((i: { id: string }) => i.id)).not.toEqual(expect.arrayContaining(seeded.itemIds)); // NEW rows
      // a second editable version is rejected (decision G)
      await post(meth.token, `/${seeded.definitionId}/versions`, { mode: 'blank' }).expect(409);
    });

    it('AA-A04 item CRUD + validation (formats, bad answerKey, duplicate ids, foreign/inactive skill, difficulty)', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId);
      const other = await makeSubject(meth.userId); // foreign subject skill
      await assign(meth.userId, subjectId);
      const def = (await post(meth.token, `/subjects/${subjectId}`, {}).expect(200)).body;
      const v = (await post(meth.token, `/${def.id}/versions`, { mode: 'blank' }).expect(201)).body;
      let token = v.version.updatedAt as string;
      const versionId = v.version.id as string;

      // valid single/multiple/true_false
      token = await addItem(meth.token, versionId, token, skillIds[0], { correct: 'a' });
      const mc = await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, format: 'multiple_choice', prompt: 'Pick', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correctOptionIds: ['a', 'b'], skillId: skillIds[1], difficulty: 3 }).expect(201);
      token = mc.body.version.updatedAt;
      const tf = await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, format: 'true_false', prompt: 'T?', options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }], correctOptionIds: ['t'], skillId: skillIds[2], difficulty: 2 }).expect(201);
      token = tf.body.version.updatedAt;
      expect(tf.body.items).toHaveLength(3);

      // bad answerKey (id not in options) → 400 ASSESSMENT_INVALID_ITEM
      const badKey = await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, ...singleChoice({ correct: 'zzz' }, skillIds[0]) });
      expect(badKey.status).toBe(400);
      expect(badKey.body.code).toBe('ASSESSMENT_INVALID_ITEM');
      // duplicate option ids → 400
      await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, format: 'single_choice', prompt: 'D', options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }], correctOptionIds: ['a'], skillId: skillIds[0], difficulty: 3 }).expect(400);
      // foreign-subject skill → 400 ASSESSMENT_SKILL_INVALID
      const foreign = await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, ...singleChoice({}, other.skillIds[0]) });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('ASSESSMENT_SKILL_INVALID');
      // difficulty out of profileScale [1,6] → 400 ASSESSMENT_INVALID_ITEM
      await post(meth.token, `/versions/${versionId}/items`, { expectedVersionUpdatedAt: token, ...singleChoice({ difficulty: 99 }, skillIds[0]) }).expect(400);

      // update with item token; delete with item token
      const detail = (await get(meth.token, `/versions/${versionId}`).expect(200)).body;
      const first = detail.items[0];
      const upd = await patch(meth.token, `/items/${first.id}`, { expectedItemUpdatedAt: first.updatedAt, ...singleChoice({ prompt: 'Edited', correct: 'b' }, skillIds[0]) }).expect(200);
      expect(upd.body.items.find((i: { id: string }) => i.id === first.id).prompt).toBe('Edited');
      // stale item token → 409
      await patch(meth.token, `/items/${first.id}`, { expectedItemUpdatedAt: first.updatedAt, ...singleChoice({ prompt: 'Z' }, skillIds[0]) }).expect(409);
      const afterUpd = (await get(meth.token, `/versions/${versionId}`).expect(200)).body;
      const delTok = afterUpd.items.find((i: { id: string }) => i.id === first.id).updatedAt;
      const afterDel = await del(meth.token, `/items/${first.id}`, { expectedItemUpdatedAt: delTok }).expect(200);
      expect(afterDel.body.items.find((i: { id: string }) => i.id === first.id)).toBeUndefined();
    });

    it('AA-A05 reorder — exact set enforced, Version OCC', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const def = (await post(meth.token, `/subjects/${subjectId}`, {}).expect(200)).body;
      const v = (await post(meth.token, `/${def.id}/versions`, { mode: 'blank' }).expect(201)).body;
      const versionId = v.version.id;
      let token = v.version.updatedAt;
      token = await addItem(meth.token, versionId, token, skillIds[0]);
      token = await addItem(meth.token, versionId, token, skillIds[1]);
      const detail = (await get(meth.token, `/versions/${versionId}`).expect(200)).body;
      const ids = detail.items.map((i: { id: string }) => i.id);
      // foreign id in set → 400
      await post(meth.token, `/versions/${versionId}/items/reorder`, { expectedVersionUpdatedAt: token, orderedItemIds: [ids[0], '00000000-0000-7000-8000-000000000000'] }).expect(400);
      // valid reverse order → 200, order persists
      const rr = await post(meth.token, `/versions/${versionId}/items/reorder`, { expectedVersionUpdatedAt: token, orderedItemIds: [ids[1], ids[0]] }).expect(200);
      expect(rr.body.items.map((i: { id: string }) => i.id)).toEqual([ids[1], ids[0]]);
    });

    it('AA-A06 config structured edit; invalid (startDifficulty outside scale) rejected', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const def = (await post(meth.token, `/subjects/${subjectId}`, {}).expect(200)).body;
      const v = (await post(meth.token, `/${def.id}/versions`, { mode: 'blank' }).expect(201)).body;
      const ok = await patch(meth.token, `/versions/${v.version.id}`, { expectedVersionUpdatedAt: v.version.updatedAt, itemsPerSkill: 1, maxItems: 20 }).expect(200);
      expect(ok.body.config).toMatchObject({ itemsPerSkill: 1, maxItems: 20 });
      // startDifficulty 99 is outside profileScale [1,6] → 400 ASSESSMENT_INVALID_CONFIG
      const bad = await patch(meth.token, `/versions/${v.version.id}`, { expectedVersionUpdatedAt: ok.body.version.updatedAt, startDifficulty: 99 });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('ASSESSMENT_INVALID_CONFIG');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('§28 readiness — warning vs blocker', () => {
    async function draftWith(meth: { token: string; userId: string }, subjectId: string): Promise<{ versionId: string; token: string }> {
      const def = (await post(meth.token, `/subjects/${subjectId}`, {}).expect(200)).body;
      const v = (await post(meth.token, `/${def.id}/versions`, { mode: 'blank' }).expect(201)).body;
      return { versionId: v.version.id, token: v.version.updatedAt };
    }

    it('AA-R01 no items → not ready (NO_ITEMS)', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const { versionId } = await draftWith(meth, subjectId);
      const r = await get(meth.token, `/versions/${versionId}/readiness`).expect(200);
      expect(r.body.publishReady).toBe(false);
      expect(r.body.blockers.map((b: { code: string }) => b.code)).toContain('NO_ITEMS');
    });

    it('AA-R02 uncovered ACTIVE subject skill is a WARNING only — still publishReady', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId, 3); // 3 active skills
      await assign(meth.userId, subjectId);
      const { versionId, token } = await draftWith(meth, subjectId);
      // default blank config itemsPerSkill=2, maxItems=10. Cover ONLY skill[0] with 2 items → 1 covered skill; 2 skills uncovered.
      let t = token;
      // set itemsPerSkill=1, maxItems=5 for a small feasible pool
      const cfg = await patch(meth.token, `/versions/${versionId}`, { expectedVersionUpdatedAt: t, itemsPerSkill: 1, maxItems: 5 }).expect(200);
      t = cfg.body.version.updatedAt;
      t = await addItem(meth.token, versionId, t, skillIds[0]);
      const r = await get(meth.token, `/versions/${versionId}/readiness`).expect(200);
      expect(r.body.publishReady).toBe(true); // decision C: uncovered active skills never block
      expect(r.body.warnings.map((w: { code: string }) => w.code)).toContain('UNCOVERED_ACTIVE_SKILL');
      expect(r.body.coverage.uncoveredSkillIds).toEqual(expect.arrayContaining([skillIds[1], skillIds[2]]));
    });

    it('AA-R03 covered skill shortage → BLOCKER; infeasible maxItems → BLOCKER', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId, 3);
      await assign(meth.userId, subjectId);
      const { versionId, token } = await draftWith(meth, subjectId);
      let t = token;
      // itemsPerSkill=2 but give skill[0] only ONE item → INSUFFICIENT_ITEMS_FOR_COVERED_SKILL
      const cfg = await patch(meth.token, `/versions/${versionId}`, { expectedVersionUpdatedAt: t, itemsPerSkill: 2, maxItems: 1 }).expect(200);
      t = cfg.body.version.updatedAt;
      t = await addItem(meth.token, versionId, t, skillIds[0]);
      const r = await get(meth.token, `/versions/${versionId}/readiness`).expect(200);
      const codes = r.body.blockers.map((b: { code: string }) => b.code);
      expect(codes).toContain('INSUFFICIENT_ITEMS_FOR_COVERED_SKILL'); // 1 < itemsPerSkill 2
      expect(codes).toContain('CONFIG_MAX_ITEMS_INFEASIBLE'); // 1 covered * 2 > maxItems 1
      expect(r.body.publishReady).toBe(false);
    });

    it('AA-R04 fully valid coverage → publishReady, no blockers', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId, 3);
      await assign(meth.userId, subjectId);
      const { versionId, token } = await draftWith(meth, subjectId);
      let t = token;
      const cfg = await patch(meth.token, `/versions/${versionId}`, { expectedVersionUpdatedAt: t, itemsPerSkill: 1, maxItems: 10 }).expect(200);
      t = cfg.body.version.updatedAt;
      for (const sk of skillIds) t = await addItem(meth.token, versionId, t, sk);
      const r = await get(meth.token, `/versions/${versionId}/readiness`).expect(200);
      expect(r.body.publishReady).toBe(true);
      expect(r.body.blockers).toHaveLength(0);
      expect(r.body.warnings).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('§29 workflow + §6 staff/learner answerKey boundary', () => {
    it('AA-W01 staff sees answerKey; learner preview never does', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId);
      await assign(meth.userId, subjectId);
      const seeded = await seedPublishedDiagnostic(meth.userId, subjectId, skillIds);
      const staff = await get(meth.token, `/versions/${seeded.versionId}`).expect(200);
      expect(staff.body.items[0].answerKey.correctOptionIds).toEqual(['a']); // staff DTO carries answerKey
      const preview = await get(meth.token, `/versions/${seeded.versionId}/preview`).expect(200);
      expect(JSON.stringify(preview.body)).not.toContain('answerKey');
      expect(JSON.stringify(preview.body)).not.toContain('correctOptionIds');
      expect(preview.body.items[0]).not.toHaveProperty('skillId');
    });

    it('AA-W02 DRAFT→REVIEW→DRAFT→REVIEW→PUBLISHED; reject direct publish + editing non-draft items', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId, 2);
      await assign(meth.userId, subjectId);
      const def = (await post(meth.token, `/subjects/${subjectId}`, {}).expect(200)).body;
      const v = (await post(meth.token, `/${def.id}/versions`, { mode: 'blank' }).expect(201)).body;
      const versionId = v.version.id;
      let t = v.version.updatedAt;
      const cfg = await patch(meth.token, `/versions/${versionId}`, { expectedVersionUpdatedAt: t, itemsPerSkill: 1, maxItems: 10 }).expect(200);
      t = cfg.body.version.updatedAt;
      for (const sk of skillIds) t = await addItem(meth.token, versionId, t, sk);

      // direct publish from DRAFT → rejected
      await post(meth.token, `/versions/${versionId}/publish`, { expectedVersionUpdatedAt: t }).expect(409);
      // submit-review
      const rev = await post(meth.token, `/versions/${versionId}/submit-review`, { expectedVersionUpdatedAt: t }).expect(200);
      expect(rev.body.version.status).toBe('REVIEW');
      t = rev.body.version.updatedAt;
      // editing a REVIEW item is rejected (immutable)
      const reviewItem = rev.body.items[0];
      await patch(meth.token, `/items/${reviewItem.id}`, { expectedItemUpdatedAt: reviewItem.updatedAt, ...singleChoice({ prompt: 'nope' }, skillIds[0]) }).expect(409);
      // return-to-draft (needs assessment.publish; METHODIST has it) with reason
      const back = await post(meth.token, `/versions/${versionId}/return-draft`, { expectedVersionUpdatedAt: t, reason: 'fix wording' }).expect(200);
      expect(back.body.version.status).toBe('DRAFT');
      t = back.body.version.updatedAt;
      // submit again then publish
      const rev2 = await post(meth.token, `/versions/${versionId}/submit-review`, { expectedVersionUpdatedAt: t }).expect(200);
      const pub = await post(meth.token, `/versions/${versionId}/publish`, { expectedVersionUpdatedAt: rev2.body.version.updatedAt }).expect(200);
      expect(pub.body.version.status).toBe('PUBLISHED');
      expect(pub.body.version.isCurrent).toBe(true);
      // definition went DRAFT → PUBLISHED on first publish
      const defAfter = (await get(meth.token, `/${def.id}`).expect(200)).body;
      expect(defAfter.definition.status).toBe('PUBLISHED');
      expect(defAfter.definition.currentVersionId).toBe(versionId);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('§22 + §30 A1 compatibility, atomic switch, pinned-attempt regression', () => {
    it('AA-I01 clone→edit→publish switches currentVersion, archives old, preserves old items, pinned attempt completes', async () => {
      const meth = await makeUser('METHODIST');
      const { subjectId, skillIds } = await makeSubject(meth.userId, 2);
      await assign(meth.userId, subjectId);
      const seeded = await seedPublishedDiagnostic(meth.userId, subjectId, skillIds, { itemsPerSkill: 1, maxItems: 10 }); // v1 PUBLISHED, current

      // learner starts a placement → pins v1
      const learner = await makeUser('LEARNER');
      const t = await prisma.track.findFirst({ where: { subjectId } });
      const intent = await prisma.learnerLearningIntent.create({ data: { userId: learner.userId, subjectId, trackId: t!.id } });
      const startRes = await request(srv()).post('/api/assessments/placement/start').set('Authorization', `Bearer ${learner.token}`).send({ learningIntentId: intent.id }).expect(200);
      const attemptId = startRes.body.attemptId as string;
      expect(startRes.body.item).toBeTruthy();

      // staff clones current → v2, edits an item, review + publish
      const cloned = (await post(meth.token, `/${seeded.definitionId}/versions`, { mode: 'clone_current' }).expect(201)).body;
      const versionId = cloned.version.id;
      const firstItem = cloned.items[0];
      const upd = await patch(meth.token, `/items/${firstItem.id}`, { expectedItemUpdatedAt: firstItem.updatedAt, ...singleChoice({ prompt: 'Edited in v2' }, skillIds[0]) }).expect(200);
      const rdy = await get(meth.token, `/versions/${versionId}/readiness`).expect(200);
      expect(rdy.body.publishReady).toBe(true);
      const rev = await post(meth.token, `/versions/${versionId}/submit-review`, { expectedVersionUpdatedAt: upd.body.version.updatedAt }).expect(200);
      await post(meth.token, `/versions/${versionId}/publish`, { expectedVersionUpdatedAt: rev.body.version.updatedAt }).expect(200);

      // currentVersion switched to v2; v1 ARCHIVED; v1 items still PUBLISHED (preserved)
      const def = await prisma.assessmentDefinition.findUnique({ where: { id: seeded.definitionId } });
      expect(def!.currentVersionId).toBe(versionId);
      expect((await prisma.assessmentDefinitionVersion.findUnique({ where: { id: seeded.versionId } }))!.status).toBe('ARCHIVED');
      for (const id of seeded.itemIds) expect((await prisma.assessmentItem.findUnique({ where: { id } }))!.status).toBe('PUBLISHED');

      // the learner's IN-PROGRESS attempt was pinned to v1 → it still completes
      let guard = 0;
      let view = await request(srv()).get(`/api/assessments/attempts/${attemptId}`).set('Authorization', `Bearer ${learner.token}`).expect(200);
      while (view.body.item && guard++ < 30) {
        const it = view.body.item;
        const answer = it.format === 'multiple_choice' ? { selectedOptionIds: [it.options[0].id] } : { selectedOptionId: it.options[0].id };
        view = await request(srv()).post(`/api/assessments/attempts/${attemptId}/responses`).set('Authorization', `Bearer ${learner.token}`).send({ itemId: it.id, answer }).expect(200);
      }
      expect(view.body.status).toBe('COMPLETED');
      expect(view.body.result).toBeTruthy();

      // a NEW learner now starts on v2
      const learner2 = await makeUser('LEARNER');
      const intent2 = await prisma.learnerLearningIntent.create({ data: { userId: learner2.userId, subjectId, trackId: t!.id } });
      const start2 = await request(srv()).post('/api/assessments/placement/start').set('Authorization', `Bearer ${learner2.token}`).send({ learningIntentId: intent2.id }).expect(200);
      const attempt2 = await prisma.assessmentAttempt.findUnique({ where: { id: start2.body.attemptId } });
      expect(attempt2!.definitionVersionId).toBe(versionId); // pinned to the new current (v2)
    });
  });
});
