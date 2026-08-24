import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { assertDemoSeedAllowed, runDemoSeed, DEMO_ADMIN, DEMO_METHODIST, DEMO_LEARNER, DEMO_SUBJECT } from '../src/bootstrap/seed-demo';
import { cleanupAuthTables } from './test-db.helper';

const ADMIN_PW = 'DemoAdmin!123';
const METHODIST_PW = 'DemoMethodist!123';
const LEARNER_PW = 'DemoLearner!123';
const OK_ENV = { nodeEnv: 'test', allowDemoSeed: 'true', adminPassword: ADMIN_PW, methodistPassword: METHODIST_PW, learnerPassword: LEARNER_PW };

describe('Demo seed (e2e, izlan_test)', () => {
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const hasher = new Argon2PasswordHasher();

  async function cleanupDemo() {
    await prisma.subjectAssignment.deleteMany({ where: { subject: { slug: DEMO_SUBJECT.slug } } });
    await prisma.subject.deleteMany({ where: { slug: DEMO_SUBJECT.slug } });
    await cleanupAuthTables(prisma);
  }

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await cleanupDemo();
    await bootstrapSystemRoles(authz);
  });
  afterAll(async () => {
    await cleanupDemo();
    await mod.close();
  });
  beforeEach(async () => {
    await cleanupDemo();
    await bootstrapSystemRoles(authz);
  });

  const deps = () => ({ prisma, authz, hasher });

  it('DEMO-01/02/03 seeds Admin + Methodist with canonical-hashed passwords and correct roles', async () => {
    await runDemoSeed(deps(), OK_ENV);

    const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone }, include: { profile: true, passwordCredential: true, roles: { include: { role: true } } } });
    const methodist = await prisma.user.findUnique({ where: { phone: DEMO_METHODIST.phone }, include: { profile: true, passwordCredential: true, roles: { include: { role: true } } } });

    // DEMO-01 credentials created
    expect(admin?.passwordCredential).toBeTruthy();
    expect(methodist?.passwordCredential).toBeTruthy();
    // DEMO-02 hashed via the canonical hasher (Argon2id; verifies with the env password; not plaintext)
    expect(admin!.passwordCredential!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin!.passwordCredential!.passwordHash).not.toContain(ADMIN_PW);
    expect(await hasher.verify(admin!.passwordCredential!.passwordHash, ADMIN_PW)).toBe(true);
    expect(await hasher.verify(methodist!.passwordCredential!.passwordHash, METHODIST_PW)).toBe(true);
    // DEMO-03 correct roles + display names
    expect(admin?.roles.map((r) => r.role.code)).toEqual(['ADMIN']);
    expect(methodist?.roles.map((r) => r.role.code)).toEqual(['METHODIST']);
    expect(admin?.profile?.displayName).toBe(DEMO_ADMIN.displayName);
    expect(methodist?.profile?.displayName).toBe(DEMO_METHODIST.displayName);
  });

  it('DEMO-04 both demo users are assigned to the English — Demo subject (DRAFT)', async () => {
    await runDemoSeed(deps(), OK_ENV);
    const subject = await prisma.subject.findUnique({ where: { slug: DEMO_SUBJECT.slug }, include: { assignments: true } });
    expect(subject?.status).toBe('DRAFT');
    const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone } });
    const methodist = await prisma.user.findUnique({ where: { phone: DEMO_METHODIST.phone } });
    const assignedUserIds = subject!.assignments.map((a) => a.userId).sort();
    expect(assignedUserIds).toEqual([admin!.id, methodist!.id].sort());
  });

  it('DEMO-05 rerun is idempotent (no duplicate users / subject / assignments)', async () => {
    await runDemoSeed(deps(), OK_ENV);
    await runDemoSeed(deps(), OK_ENV);
    expect(await prisma.user.count({ where: { phone: { in: [DEMO_ADMIN.phone, DEMO_METHODIST.phone, DEMO_LEARNER.phone] } } })).toBe(3);
    expect(await prisma.subject.count({ where: { slug: DEMO_SUBJECT.slug } })).toBe(1);
    expect(await prisma.subjectAssignment.count({ where: { subject: { slug: DEMO_SUBJECT.slug } } })).toBe(2);
    // credential + role still exactly one each
    const admin = await prisma.user.findUnique({ where: { phone: DEMO_ADMIN.phone } });
    expect(await prisma.userRole.count({ where: { userId: admin!.id } })).toBe(1);
  });

  it('DEMO-06 production refuses; missing ALLOW_DEMO_SEED / passwords refuse', () => {
    expect(() => assertDemoSeedAllowed({ ...OK_ENV, nodeEnv: 'production' })).toThrow();
    expect(() => assertDemoSeedAllowed({ ...OK_ENV, allowDemoSeed: 'false' })).toThrow();
    expect(() => assertDemoSeedAllowed({ ...OK_ENV, adminPassword: undefined })).toThrow();
    expect(() => assertDemoSeedAllowed({ ...OK_ENV, learnerPassword: undefined })).toThrow();
  });

  it('DEMO-LEARNER-01..05 seeds a LEARNER-only demo account (no staff role, no assignment), idempotent', async () => {
    await runDemoSeed(deps(), OK_ENV);
    await runDemoSeed(deps(), OK_ENV); // DEMO-LEARNER-05 idempotent
    const learner = await prisma.user.findUnique({
      where: { phone: DEMO_LEARNER.phone },
      include: { profile: true, passwordCredential: true, roles: { include: { role: true } } },
    });
    expect(learner).toBeTruthy();
    // DEMO-LEARNER-01 role exactly LEARNER · DEMO-LEARNER-04 no ADMIN/METHODIST/MODERATOR
    expect(learner!.roles.map((r) => r.role.code)).toEqual(['LEARNER']);
    // DEMO-LEARNER-02 PasswordCredential exists (Argon2id; verifies)
    expect(learner!.passwordCredential).toBeTruthy();
    expect(await hasher.verify(learner!.passwordCredential!.passwordHash, LEARNER_PW)).toBe(true);
    // DEMO-LEARNER-03 no SubjectAssignment
    expect(await prisma.subjectAssignment.count({ where: { userId: learner!.id } })).toBe(0);
    // incomplete onboarding (no dateOfBirth / onboardingCompletedAt) so the onboarding UI can be exercised
    expect(learner!.profile?.onboardingCompletedAt).toBeNull();
    expect(learner!.profile?.dateOfBirth).toBeNull();
    // idempotent — exactly one role/credential row
    expect(await prisma.userRole.count({ where: { userId: learner!.id } })).toBe(1);
  });
});
