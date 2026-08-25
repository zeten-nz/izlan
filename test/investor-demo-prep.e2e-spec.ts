import { Test, TestingModule } from '@nestjs/testing';
import { ContainerStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { runInvestorDemoPrep } from '../src/bootstrap/prepare-investor-demo';
import { DEMO_ADMIN, DEMO_LEARNER, DEMO_METHODIST, DEMO_SUBJECT } from '../src/bootstrap/seed-demo';
import { RUNTIME_LEARNER, RUNTIME_SUBJECT } from '../src/bootstrap/seed-runtime';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';

const OK_ENV = {
  nodeEnv: 'test',
  allowInvestorDemo: 'true',
  allowDemoSeed: 'true',
  allowDevFixture: 'true',
  adminPassword: 'DemoAdmin!123',
  methodistPassword: 'DemoMethodist!123',
  learnerPassword: 'DemoLearner!123',
};

describe('Investor demo prep (e2e, izlan_test)', () => {
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const hasher = new Argon2PasswordHasher();

  async function resetAll() {
    await cleanupRoadmapContent(prisma);
    await cleanupAssessmentTables(prisma);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.subjectAssignment.deleteMany();
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
  afterAll(async () => { await resetAll(); await mod.close(); });
  beforeEach(async () => { await resetAll(); await bootstrapSystemRoles(authz); });

  const deps = () => ({ prisma, authz, hasher });

  it('INV-DEMO-01 fails CLOSED (up front, no DB writes) without every opt-in / in production', async () => {
    await expect(runInvestorDemoPrep(deps(), { ...OK_ENV, allowInvestorDemo: undefined })).rejects.toThrow(/ALLOW_INVESTOR_DEMO/);
    await expect(runInvestorDemoPrep(deps(), { ...OK_ENV, allowDemoSeed: undefined })).rejects.toThrow(/ALLOW_DEMO_SEED/); // sub-guard not bypassed
    await expect(runInvestorDemoPrep(deps(), { ...OK_ENV, allowDevFixture: undefined })).rejects.toThrow(/ALLOW_DEV_FIXTURE/); // sub-guard not bypassed
    await expect(runInvestorDemoPrep(deps(), { ...OK_ENV, nodeEnv: 'production' })).rejects.toThrow(/forbidden in production/);
    // nothing was created by ANY of the rejected attempts (fail-closed up front — no partial seed)
    expect(await prisma.user.findUnique({ where: { phone: RUNTIME_LEARNER.phone } })).toBeNull();
    expect(await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } })).toBeNull();
  });

  it('INV-DEMO-02 composes staff + both learner personas + published subject + placement', async () => {
    const r = await runInvestorDemoPrep(deps(), OK_ENV);

    // staff
    const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone }, include: { roles: { include: { role: true } }, passwordCredential: true } });
    const methodist = await prisma.user.findUnique({ where: { phone: DEMO_METHODIST.phone }, include: { roles: { include: { role: true } } } });
    expect(admin?.roles.map((x) => x.role.code)).toContain('ADMIN');
    expect(admin?.passwordCredential).toBeTruthy();
    expect(methodist?.roles.map((x) => x.role.code)).toContain('METHODIST');

    // FRESH learner (+...003): incomplete onboarding, no derived state
    const fresh = await prisma.user.findUnique({ where: { phone: DEMO_LEARNER.phone }, include: { profile: true } });
    expect(fresh?.profile?.onboardingCompletedAt).toBeNull();
    expect(fresh?.profile?.dateOfBirth).toBeNull();
    expect(await prisma.learnerLearningIntent.count({ where: { userId: fresh!.id } })).toBe(0);

    // RETURNING learner (+...004): onboarded + a learning intent for the runtime subject
    const returning = await prisma.user.findUnique({ where: { phone: RUNTIME_LEARNER.phone }, include: { profile: true } });
    expect(returning?.profile?.onboardingCompletedAt).not.toBeNull();
    expect(await prisma.learnerLearningIntent.count({ where: { userId: returning!.id } })).toBe(1);

    // published runtime subject with PUBLISHED placement pool; demo subject stays DRAFT
    const subject = await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } });
    expect(subject?.status).toBe(ContainerStatus.PUBLISHED);
    expect(r.placementPoolSize).toBeGreaterThan(0);
    expect(r.runtimeLessonCount).toBeGreaterThan(0);
    const demoSubject = await prisma.subject.findUnique({ where: { slug: DEMO_SUBJECT.slug } });
    expect(demoSubject?.status).toBe(ContainerStatus.DRAFT);
  });

  it('INV-DEMO-03 investor-visible titles are polished (no dev-grade labels)', async () => {
    await runInvestorDemoPrep(deps(), OK_ENV);
    const subject = await prisma.subject.findUnique({ where: { slug: RUNTIME_SUBJECT.slug } });
    expect(subject?.title).toBe('English — Beginner (A1)');
    expect(subject?.title).not.toMatch(/dev|runtime|fixture/i);
    expect(subject?.description ?? '').not.toMatch(/dev|runtime|fixture/i);
  });

  it('INV-DEMO-04 rerun is idempotent (no duplicate subject / placement definition / pool growth)', async () => {
    const first = await runInvestorDemoPrep(deps(), OK_ENV);
    const second = await runInvestorDemoPrep(deps(), OK_ENV);

    expect(await prisma.subject.count({ where: { slug: RUNTIME_SUBJECT.slug } })).toBe(1);
    expect(await prisma.assessmentDefinition.count({ where: { subjectId: first.runtimeSubjectId } })).toBe(1);
    expect(second.placementPoolSize).toBe(first.placementPoolSize); // pool not re-seeded/duplicated
    expect(await prisma.user.count({ where: { phone: { in: [DEMO_ADMIN.phone, DEMO_METHODIST.phone, DEMO_LEARNER.phone, RUNTIME_LEARNER.phone] } } })).toBe(4);
  });
});
