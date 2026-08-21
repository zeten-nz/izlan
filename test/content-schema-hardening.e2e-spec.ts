import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SMS_PORT } from '../src/sms/sms.port';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

/**
 * Phase 2.2A-D — content schema hardening (schema-contract e2e, izlan_test). Proves the ACTUAL migrated PostgreSQL
 * constraints: `lesson.content_key` NOT NULL + globally UNIQUE, and the `lesson_prerequisite`
 * `chk_lesson_prerequisite_no_self_loop` CHECK (`lesson_id <> prerequisite_lesson_id`). Full multi-node DAG cycle
 * prevention (A→B→C→A) is intentionally DEFERRED to Phase 2.2A (service/transaction validation) — a row-level CHECK
 * cannot detect it, and nothing here asserts multi-node-cycle behavior.
 */
describe('Content schema hardening (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(new TestSmsAdapter()).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(reset);

  async function reset() {
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const uid = () => `${Date.now()}-${n++}`;
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(7000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);

  /** Minimal Subject→Track→Level→Module→Topic chain; returns a topicId. */
  async function seedTopic(creatorId: string): Promise<string> {
    const subject = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'S', createdBy: creatorId }, select: { id: true } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: `t-${uid()}`, title: 'T', createdBy: creatorId }, select: { id: true } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: `C${so++}`, title: 'L', sortOrder: so++, createdBy: creatorId }, select: { id: true } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'M', sortOrder: so++, createdBy: creatorId }, select: { id: true } });
    const topic = await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: so++, createdBy: creatorId }, select: { id: true } });
    return topic.id;
  }
  const mkLesson = (topicId: string, creatorId: string, contentKey: string) =>
    prisma.lesson.create({ data: { topicId, contentKey, sortOrder: so++, createdBy: creatorId }, select: { id: true, contentKey: true } });

  // ── CSH-DB-01: valid unique contentKey persists ──
  it('CSH-DB-01 a Lesson can be created with a valid unique contentKey', async () => {
    const creatorId = await seedUser();
    const topicId = await seedTopic(creatorId);
    const ck = `ck-${uid()}`;
    const lesson = await mkLesson(topicId, creatorId, ck);
    expect(lesson.contentKey).toBe(ck);
  });

  // ── CSH-DB-02: contentKey is globally unique (DB) ──
  it('CSH-DB-02 two Lessons cannot share the same contentKey (DB unique violation)', async () => {
    const creatorId = await seedUser();
    const topicId = await seedTopic(creatorId);
    const ck = `ck-dup-${uid()}`;
    await mkLesson(topicId, creatorId, ck);
    await expect(mkLesson(topicId, creatorId, ck)).rejects.toMatchObject({ code: 'P2002' });
  });

  // ── CSH-DB-03: self-loop prerequisite rejected at the DB CHECK ──
  it('CSH-DB-03 LessonPrerequisite rejects a self-loop (lessonId == prerequisiteLessonId) at the DB constraint', async () => {
    const creatorId = await seedUser();
    const topicId = await seedTopic(creatorId);
    const a = await mkLesson(topicId, creatorId, `ck-${uid()}`);
    await expect(
      prisma.lessonPrerequisite.create({ data: { lessonId: a.id, prerequisiteLessonId: a.id } }),
    ).rejects.toThrow(/chk_lesson_prerequisite_no_self_loop|check constraint|violat|23514/i);
  });

  // ── CSH-DB-04: a normal non-self edge is allowed ──
  it('CSH-DB-04 a normal non-self prerequisite edge (B requires A) is allowed', async () => {
    const creatorId = await seedUser();
    const topicId = await seedTopic(creatorId);
    const a = await mkLesson(topicId, creatorId, `ck-${uid()}`);
    const b = await mkLesson(topicId, creatorId, `ck-${uid()}`);
    const edge = await prisma.lessonPrerequisite.create({ data: { lessonId: b.id, prerequisiteLessonId: a.id }, select: { id: true } });
    expect(edge.id).toBeTruthy();
  });
});
