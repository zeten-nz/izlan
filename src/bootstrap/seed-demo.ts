import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationRepository } from '../authorization/authorization.repository';
import { Argon2PasswordHasher, type PasswordHasher } from '../auth/password/password-hasher';
import { assertPasswordPolicy } from '../auth/password/password-policy';
import { bootstrapSystemRoles } from './system-roles';

/**
 * DEV/staging demo seed (§17-20, TD-252). `npm run db:seed:demo`. Idempotent; NON-production only.
 * Creates two demo staff accounts + one DRAFT subject and assigns both — exercising the REAL authorization model
 * (ADMIN has NO SubjectAssignment bypass). Passwords come from env (never hard-coded), hashed via the production hasher.
 */
export const DEMO_ADMIN = { phone: '+998900000001', displayName: 'Izlan Demo Admin', roleCode: 'ADMIN' } as const;
export const DEMO_METHODIST = { phone: '+998900000002', displayName: 'Izlan Demo Methodist', roleCode: 'METHODIST' } as const;
export const DEMO_SUBJECT = { slug: 'english-demo', title: 'English — Demo' } as const;

export interface DemoSeedEnv {
  nodeEnv: string | undefined;
  allowDemoSeed: string | undefined;
  adminPassword: string | undefined;
  methodistPassword: string | undefined;
}

/** Fail closed: forbidden in production, requires ALLOW_DEMO_SEED=true and both demo passwords (policy-valid). */
export function assertDemoSeedAllowed(env: DemoSeedEnv): { adminPassword: string; methodistPassword: string } {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('db:seed:demo is forbidden in production');
  if ((env.allowDemoSeed ?? '').trim() !== 'true') throw new Error('db:seed:demo requires ALLOW_DEMO_SEED=true');
  if (!env.adminPassword || !env.methodistPassword) throw new Error('DEMO_ADMIN_PASSWORD and DEMO_METHODIST_PASSWORD are required');
  assertPasswordPolicy(env.adminPassword);
  assertPasswordPolicy(env.methodistPassword);
  return { adminPassword: env.adminPassword, methodistPassword: env.methodistPassword };
}

interface Deps {
  prisma: PrismaService;
  authz: AuthorizationRepository;
  hasher: PasswordHasher;
}

async function ensureUser(deps: Deps, def: { phone: string; displayName: string; roleCode: string }, password: string): Promise<string> {
  const { prisma, hasher } = deps;
  const existing = await prisma.user.findUnique({ where: { phone: def.phone } });
  const user = existing ?? (await prisma.user.create({ data: { phone: def.phone } }));
  await prisma.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, displayName: def.displayName }, update: { displayName: def.displayName } });
  const role = await prisma.role.findUnique({ where: { code: def.roleCode } });
  if (!role) throw new Error(`role ${def.roleCode} not bootstrapped`);
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id, grantedBy: null }, update: {} });
  const passwordHash = await hasher.hash(password);
  await prisma.passwordCredential.upsert({ where: { userId: user.id }, create: { userId: user.id, passwordHash }, update: { passwordHash } });
  return user.id;
}

/** Idempotent demo seed. Returns the created/ensured ids. No destructive rewrite of existing data. */
export async function runDemoSeed(deps: Deps, env: DemoSeedEnv): Promise<{ adminId: string; methodistId: string; subjectId: string }> {
  const { adminPassword, methodistPassword } = assertDemoSeedAllowed(env);
  await bootstrapSystemRoles(deps.authz);

  const adminId = await ensureUser(deps, DEMO_ADMIN, adminPassword);
  const methodistId = await ensureUser(deps, DEMO_METHODIST, methodistPassword);

  const existingSubject = await deps.prisma.subject.findUnique({ where: { slug: DEMO_SUBJECT.slug } });
  const subject = existingSubject ?? (await deps.prisma.subject.create({ data: { slug: DEMO_SUBJECT.slug, title: DEMO_SUBJECT.title, status: 'DRAFT', createdBy: adminId } }));
  for (const userId of [adminId, methodistId]) {
    await deps.prisma.subjectAssignment.upsert({
      where: { userId_subjectId: { userId, subjectId: subject.id } },
      create: { userId, subjectId: subject.id, assignedBy: adminId },
      update: {},
    });
  }
  return { adminId, methodistId, subjectId: subject.id };
}

async function main(): Promise<void> {
  const logger = new Logger('SeedDemo');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await runDemoSeed(
      { prisma: app.get(PrismaService), authz: app.get(AuthorizationRepository), hasher: new Argon2PasswordHasher() },
      { nodeEnv: process.env.NODE_ENV, allowDemoSeed: process.env.ALLOW_DEMO_SEED, adminPassword: process.env.DEMO_ADMIN_PASSWORD, methodistPassword: process.env.DEMO_METHODIST_PASSWORD },
    );
    logger.log(`Demo seed complete — admin=${DEMO_ADMIN.phone} methodist=${DEMO_METHODIST.phone} subject=${DEMO_SUBJECT.slug} (${result.subjectId})`);
  } finally {
    await app.close();
  }
}

// Only run as a CLI entrypoint, not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    new Logger('SeedDemo').error(`Demo seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
