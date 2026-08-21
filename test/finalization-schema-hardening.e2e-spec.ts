import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { IzlReservationStatus, LedgerEntryType } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { IzlWalletRepository } from '../src/finance/wallet/izl-wallet.repository';
import { SMS_PORT } from '../src/sms/sms.port';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

/**
 * Phase 2.1G-D DB-invariant hardening (schema only — no finalizer, no producers). Exercises FP-DB-01 (billing period),
 * FP-DB-04 (one REDEEM per redemption), and the CONSUMED reserved-SUM exclusion (§22/§55) via direct fixtures.
 */
describe('Finalization schema hardening (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let wallet: IzlWalletRepository;
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(new TestSmsAdapter()).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    wallet = moduleRef.get(IzlWalletRepository);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(reset);

  async function reset() {
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLRedemption.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.iZLWallet.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const uid = () => `${Date.now()}-${n++}`;
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(2000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);

  // ── FP-DB-01: billing period > 0 ──
  it('§47/FP-DB-01 PlanPrice.billingPeriodMonths must be positive; valid value persists immutably', async () => {
    const userId = await seedUser();
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'X', sortOrder: so++ } });
    const base = { planId: plan.id, amount: 100000, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId };
    await expect(prisma.planPrice.create({ data: { ...base, currency: 'A', billingPeriodMonths: 0 } })).rejects.toThrow(/chk_plan_price_billing_period_positive|constraint|23514/i);
    await expect(prisma.planPrice.create({ data: { ...base, currency: 'B', billingPeriodMonths: -1 } })).rejects.toThrow();
    const ok = await prisma.planPrice.create({ data: { ...base, currency: 'UZS', billingPeriodMonths: 1 }, select: { billingPeriodMonths: true } });
    expect(ok.billingPeriodMonths).toBe(1);
  });

  // ── CONSUMED reserved-SUM exclusion (§22/§55) ──
  it('§55/§22 reserved SUM counts ACTIVE only — RELEASED and CONSUMED are excluded', async () => {
    const userId = await seedUser();
    const mk = (status: IzlReservationStatus, amountIzl: number, key: string) =>
      prisma.iZLReservation.create({ data: { userId, amountIzl, status, idempotencyKey: key, purposeCode: 'TEST' } });
    await mk(IzlReservationStatus.ACTIVE, 4, `a-${uid()}`);
    await mk(IzlReservationStatus.RELEASED, 4, `r-${uid()}`);
    await mk(IzlReservationStatus.CONSUMED, 4, `c-${uid()}`); // fixture only — no runtime producer exists yet
    expect(await wallet.activeReservedTotal(userId)).toBe(4); // ACTIVE only
  });

  // ── FP-DB-04: one REDEEM per redemption ──
  it('§56/FP-DB-04 at most one REDEEM ledger entry per redemption; other entry types stay allowed', async () => {
    const userId = await seedUser();
    const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl: 4, izlRateSnapshot: 1000, valueUzs: 4000, status: 'RESERVED' }, select: { id: true } });
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: LedgerEntryType.REDEEM, amount: -4, balanceAfter: -4, redemptionId: red.id } });
    // second REDEEM for the same redemption → rejected by the partial unique
    await expect(prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 2, entryType: LedgerEntryType.REDEEM, amount: -4, balanceAfter: -8, redemptionId: red.id } })).rejects.toMatchObject({ code: 'P2002' });
    // a different entry type with the same redemption provenance remains possible (reversal/audit)
    const rev = await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 2, entryType: LedgerEntryType.REVERSAL, amount: 4, balanceAfter: 0, redemptionId: red.id }, select: { id: true } });
    expect(rev.id).toBeTruthy();
  });
});
