import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationRepository } from '../authorization/authorization.repository';
import { Argon2PasswordHasher, type PasswordHasher } from '../auth/password/password-hasher';
import { DEMO_ADMIN, DEMO_LEARNER, DEMO_METHODIST, runDemoSeed } from './seed-demo';
import { RUNTIME_LEARNER, RUNTIME_SUBJECT, runRuntimeFixture } from './seed-runtime';

/**
 * Investor-demo preparation (`npm run db:prepare:investor-demo`). It ORCHESTRATES the existing, already-guarded seeds
 * — it reimplements nothing:
 *   system roles → guarded demo accounts (runDemoSeed) → guarded runtime placement/content fixture (runRuntimeFixture).
 *
 * Safety model: it does NOT bypass any sub-seed guard. It adds its OWN explicit gate (`ALLOW_INVESTOR_DEMO=true`) on
 * top of — and preserves — the sub-seeds' fail-closed guards, so the operator must ALSO set `ALLOW_DEMO_SEED=true` and
 * `ALLOW_DEV_FIXTURE=true`. All flags are checked UP FRONT (fail closed before any DB write, so a missing sub-flag can
 * never leave a partial seed), and each sub-seed re-checks them independently (defence in depth). Production is
 * forbidden by every layer. No secrets are hard-coded (passwords are env-owned) and none are printed. This is a one-off
 * DATA SETUP step for a NON-production staging DB; it does not change the deployed app build. It does NOT reset
 * accumulated learner state between presentations — see INVESTOR_DEMO_STAGING_RUNBOOK.md's snapshot/restore strategy.
 */
export interface InvestorDemoEnv {
  nodeEnv: string | undefined;
  allowInvestorDemo: string | undefined;
  allowDemoSeed: string | undefined; // the composed demo seed's own opt-in — passed through, NOT forced
  allowDevFixture: string | undefined; // the composed runtime fixture's own opt-in — passed through, NOT forced
  adminPassword: string | undefined;
  methodistPassword: string | undefined;
  learnerPassword: string | undefined;
}

/**
 * Fail closed, up front (before any DB write): forbidden in production; requires ALL THREE explicit opt-ins
 * (ALLOW_INVESTOR_DEMO + ALLOW_DEMO_SEED + ALLOW_DEV_FIXTURE) so no composed sub-seed guard is bypassed; and requires
 * the three env-owned demo passwords.
 */
export function assertInvestorDemoAllowed(env: InvestorDemoEnv): void {
  if ((env.nodeEnv ?? '').trim() === 'production') throw new Error('db:prepare:investor-demo is forbidden in production');
  if ((env.allowInvestorDemo ?? '').trim() !== 'true') throw new Error('db:prepare:investor-demo requires ALLOW_INVESTOR_DEMO=true');
  if ((env.allowDemoSeed ?? '').trim() !== 'true') throw new Error('db:prepare:investor-demo composes the demo seed and requires ALLOW_DEMO_SEED=true');
  if ((env.allowDevFixture ?? '').trim() !== 'true') throw new Error('db:prepare:investor-demo composes the runtime fixture and requires ALLOW_DEV_FIXTURE=true');
  if (!env.adminPassword || !env.methodistPassword || !env.learnerPassword) {
    throw new Error('DEMO_ADMIN_PASSWORD, DEMO_METHODIST_PASSWORD and DEMO_LEARNER_PASSWORD are required');
  }
}

interface Deps {
  prisma: PrismaService;
  authz: AuthorizationRepository;
  hasher: PasswordHasher;
}

export interface InvestorDemoResult {
  demoAdminPhone: string;
  demoMethodistPhone: string;
  freshLearnerPhone: string; // onboarding-from-scratch persona
  returningLearnerPhone: string; // pre-onboarded persona
  runtimeSubjectSlug: string;
  runtimeSubjectId: string;
  runtimeLessonCount: number;
  placementPoolSize: number;
}

/** Compose the existing seeds under the investor gate. Idempotent (each composed sub-seed is idempotent by natural keys). */
export async function runInvestorDemoPrep(deps: Deps, env: InvestorDemoEnv): Promise<InvestorDemoResult> {
  assertInvestorDemoAllowed(env);

  // Staff accounts + the DRAFT demo subject (english-demo) — leaves the fresh demo learner (+...003) deliberately
  // INCOMPLETE for onboarding-from-scratch.
  await runDemoSeed(deps, {
    nodeEnv: env.nodeEnv,
    allowDemoSeed: env.allowDemoSeed, // pass the operator's real flag through — the sub-seed still enforces it
    adminPassword: env.adminPassword,
    methodistPassword: env.methodistPassword,
    learnerPassword: env.learnerPassword,
  });

  // Published subject/track/lessons + PUBLISHED diagnostic placement + the pre-onboarded returning learner (+...004).
  const runtime = await runRuntimeFixture(deps, {
    nodeEnv: env.nodeEnv,
    allowDevFixture: env.allowDevFixture, // pass the operator's real flag through — the sub-seed still enforces it
    adminPassword: env.adminPassword,
    learnerPassword: env.learnerPassword,
  });

  return {
    demoAdminPhone: DEMO_ADMIN.phone,
    demoMethodistPhone: DEMO_METHODIST.phone,
    freshLearnerPhone: DEMO_LEARNER.phone,
    returningLearnerPhone: RUNTIME_LEARNER.phone,
    runtimeSubjectSlug: RUNTIME_SUBJECT.slug,
    runtimeSubjectId: runtime.subjectId,
    runtimeLessonCount: runtime.lessonIds.length,
    placementPoolSize: runtime.poolSize,
  };
}

async function main(): Promise<void> {
  const logger = new Logger('InvestorDemoPrep');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const r = await runInvestorDemoPrep(
      { prisma: app.get(PrismaService), authz: app.get(AuthorizationRepository), hasher: new Argon2PasswordHasher() },
      {
        nodeEnv: process.env.NODE_ENV,
        allowInvestorDemo: process.env.ALLOW_INVESTOR_DEMO,
        allowDemoSeed: process.env.ALLOW_DEMO_SEED,
        allowDevFixture: process.env.ALLOW_DEV_FIXTURE,
        adminPassword: process.env.DEMO_ADMIN_PASSWORD,
        methodistPassword: process.env.DEMO_METHODIST_PASSWORD,
        learnerPassword: process.env.DEMO_LEARNER_PASSWORD,
      },
    );
    logger.log(`Investor demo prepared — staff: admin=${r.demoAdminPhone} methodist=${r.demoMethodistPhone}`);
    logger.log(`Learners — fresh(onboarding)=${r.freshLearnerPhone}  returning(onboarded)=${r.returningLearnerPhone}`);
    logger.log(`Runtime subject=${r.runtimeSubjectSlug} (${r.runtimeSubjectId}) lessons=${r.runtimeLessonCount} placementPool=${r.placementPoolSize}`);
    logger.log('Passwords are env-owned and never printed. Polished curriculum is loaded via Content Studio / Bulk Import — see INVESTOR_DEMO_CONTENT_RUNBOOK.md.');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('InvestorDemoPrep').error(`Investor demo prep failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
