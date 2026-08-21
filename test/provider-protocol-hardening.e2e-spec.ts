import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ClickProtocolPhaseState, PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentProviderBindingService } from '../src/payments/payment-provider-binding.service';
import { PaymeProtocolRepository } from '../src/payments/payme-protocol.repository';
import { ClickProtocolRepository } from '../src/payments/click-protocol.repository';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

/**
 * Phase 2.1L-D — provider contract / persistence hardening (schema + non-terminal binding + provider-specific durable
 * protocol persistence). NO real adapter / route / provider call / refund / core terminal transition is exercised.
 * Payme facts are verified from developer.help.paycom.uz; CLICK is a provider-neutral shell under the standing CLICK
 * PROTOCOL VERIFICATION BLOCKER (only replay-stability is proven, never native signature/amount/error logic).
 */
describe('Provider protocol hardening (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let binding: PaymentProviderBindingService;
  let payme: PaymeProtocolRepository;
  let click: ClickProtocolRepository;
  const providerAdapter = new TestPaymentProviderAdapter();
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(new TestSmsAdapter())
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    binding = moduleRef.get(PaymentProviderBindingService);
    payme = moduleRef.get(PaymeProtocolRepository);
    click = moduleRef.get(ClickProtocolRepository);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.paymeMerchantTransaction.deleteMany();
    await prisma.clickShopTransaction.deleteMany();
    await prisma.paymentCallbackEvent.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLRedemption.deleteMany();
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.iZLWallet.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const uid = () => `${Date.now()}-${n++}`;
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(6000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);

  async function seedOrder(userId: string) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ }, select: { id: true } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId }, select: { id: true } });
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: 0, payableAmount: 100000, status: 'PENDING' }, select: { id: true } });
    return order.id;
  }
  const seedTx = (orderId: string, status: PaymentTransactionStatus = 'PENDING', o: { provider?: PaymentProvider; providerTransactionId?: string | null } = {}) =>
    prisma.paymentTransaction.create({ data: { paymentOrderId: orderId, provider: o.provider ?? 'PAYME', amount: 100000, status, providerTransactionId: o.providerTransactionId ?? (status === 'PENDING' ? null : `ext-${uid()}`), confirmedAt: status === 'SUCCEEDED' ? new Date('2026-08-20T07:00:00Z') : null }, select: { id: true } }).then((t) => t.id);
  async function seedPendingAttempt(provider: PaymentProvider = 'PAYME') {
    const userId = await seedUser();
    const orderId = await seedOrder(userId);
    const txId = await seedTx(orderId, 'PENDING', { provider });
    return { userId, orderId, txId };
  }
  const txn = (id: string) => prisma.paymentTransaction.findUnique({ where: { id } });
  const ord = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });

  // ═══════════════════════════ Non-terminal provider binding (§17, TD-234) ═══════════════════════════

  it('§17 first bind attaches the external id; PT stays PENDING, order untouched (non-terminal)', async () => {
    const { orderId, txId } = await seedPendingAttempt('PAYME');
    const res = await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'payme-1');
    expect(res.outcome).toBe('BOUND');
    const pt = (await txn(txId))!;
    expect(pt.providerTransactionId).toBe('payme-1');
    expect(pt.status).toBe('PENDING'); // no terminal transition
    expect((await ord(orderId))!.status).toBe('PENDING'); // order untouched
  });

  it('§17 same-id replay is idempotent (ALREADY_BOUND); a different id is a CONFLICT (no overwrite)', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    expect((await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'p1')).outcome).toBe('BOUND');
    expect((await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'p1')).outcome).toBe('ALREADY_BOUND');
    const conflict = await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'p2');
    expect(conflict).toMatchObject({ outcome: 'CONFLICT', reason: 'EXTERNAL_ID_ALREADY_ATTACHED' });
    expect((await txn(txId))!.providerTransactionId).toBe('p1'); // preserved
  });

  it('§17 provider mismatch is refused; non-PENDING (SUCCEEDED) attempt is never re-bound', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    expect(await binding.bindProviderTransactionId(txId, PaymentProvider.CLICK, 'x')).toMatchObject({ outcome: 'CONFLICT', reason: 'PROVIDER_MISMATCH' });

    const userId = await seedUser();
    const orderId = await seedOrder(userId);
    const succeeded = await seedTx(orderId, 'SUCCEEDED', { provider: 'PAYME', providerTransactionId: 'already' });
    expect(await binding.bindProviderTransactionId(succeeded, PaymentProvider.PAYME, 'new')).toMatchObject({ outcome: 'NOT_BINDABLE', reason: 'TRANSACTION_NOT_PENDING' });
  });

  it('§17 cross-attempt external-id integrity — the same external id cannot bind to two attempts (PT-DB-03)', async () => {
    const a = await seedPendingAttempt('CLICK');
    const b = await seedPendingAttempt('CLICK');
    expect((await binding.bindProviderTransactionId(a.txId, PaymentProvider.CLICK, 'shared')).outcome).toBe('BOUND');
    expect(await binding.bindProviderTransactionId(b.txId, PaymentProvider.CLICK, 'shared')).toMatchObject({ outcome: 'CONFLICT', reason: 'EXTERNAL_ID_IN_USE' });
    expect((await txn(b.txId))!.providerTransactionId).toBeNull();
  });

  it('§17 empty id and unknown transaction are NOT_BINDABLE; concurrent bind of the same id → one BOUND, one ALREADY_BOUND', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    expect(await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, '  ')).toMatchObject({ outcome: 'NOT_BINDABLE', reason: 'EXTERNAL_ID_REQUIRED' });
    expect(await binding.bindProviderTransactionId('00000000-0000-7000-8000-000000000000', PaymentProvider.PAYME, 'x')).toMatchObject({ outcome: 'NOT_BINDABLE', reason: 'TRANSACTION_NOT_FOUND' });
    const [r1, r2] = await Promise.all([
      binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'cc'),
      binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'cc'),
    ]);
    expect([r1.outcome, r2.outcome].sort()).toEqual(['ALREADY_BOUND', 'BOUND']);
    expect((await txn(txId))!.providerTransactionId).toBe('cc');
  });

  // ═══════════════════════════ Payme protocol persistence (§3/§5/§8/§9/§23, TD-233/235/236) ═══════════════════════════

  const create = (txId: string, paymeId: string, over: Partial<{ providerCreatedTimeMs: bigint; amountTiyin: bigint; nowMs: bigint; accountSnapshot: object }> = {}) =>
    payme.recordCreate({ paymentTransactionId: txId, paymeTransactionId: paymeId, providerCreatedTimeMs: over.providerCreatedTimeMs ?? 1_700_000_000_000n, amountTiyin: over.amountTiyin ?? 9_600_000n, accountSnapshot: over.accountSnapshot ?? { paymentTransactionId: txId }, nowMs: over.nowMs ?? 1_700_000_001_000n });

  it('§3/§5 CreateTransaction persists state 1 with tiyin + Payme creation time preserved verbatim (BigInt, no coercion)', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    const res = await create(txId, 'pm-1', { providerCreatedTimeMs: 1_699_999_999_999n, amountTiyin: 9_600_000n });
    expect(res.outcome).toBe('CREATED');
    const row = (await prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId: 'pm-1' } }))!;
    expect(row.state).toBe(1);
    expect(row.amountTiyin).toBe(9_600_000n);
    expect(row.providerCreatedTimeMs).toBe(1_699_999_999_999n); // Payme `time`, not local createdAt (§8)
    expect(row.performTimeMs).toBeNull();
    expect(row.cancelTimeMs).toBeNull();
  });

  it('§5 CreateTransaction replay preserves create_time even when the clock advances; conflicting binds are refused', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    await create(txId, 'pm-1', { nowMs: 111n, providerCreatedTimeMs: 500n });
    const replay = await create(txId, 'pm-1', { nowMs: 999n, providerCreatedTimeMs: 500n });
    expect(replay.outcome).toBe('ALREADY_CREATED');
    expect((await prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId: 'pm-1' } }))!.createTimeMs).toBe(111n); // immutable

    expect((await create(txId, 'pm-DIFFERENT')).outcome).toBe('CONFLICT'); // one Payme id per attempt
    const other = await seedPendingAttempt('PAYME');
    expect((await create(other.txId, 'pm-1')).outcome).toBe('CONFLICT'); // Payme id already used elsewhere
  });

  it('§5/§35 PerformTransaction sets perform_time once (state 2); replay preserves it, no new time on retry', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    await create(txId, 'pm-1');
    const performed = await payme.recordPerform('pm-1', 222n);
    expect(performed).toMatchObject({ outcome: 'PERFORMED', state: 2 });
    const replay = await payme.recordPerform('pm-1', 888n);
    expect(replay.outcome).toBe('ALREADY_PERFORMED');
    const row = (await prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId: 'pm-1' } }))!;
    expect(row.performTimeMs).toBe(222n); // immutable on replay
    expect(row.cancelTimeMs).toBeNull();
  });

  it('§6 pre-success CancelTransaction → state -1 with reason + cancel_time once; replay preserves both', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    await create(txId, 'pm-1');
    const cancelled = await payme.recordCancel('pm-1', 4, 333n);
    expect(cancelled).toMatchObject({ outcome: 'CANCELLED', state: -1 });
    const replay = await payme.recordCancel('pm-1', 9, 777n);
    expect(replay.outcome).toBe('ALREADY_CANCELLED');
    const row = (await prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId: 'pm-1' } }))!;
    expect(row.cancelTimeMs).toBe(333n);
    expect(row.reason).toBe(4); // preserved provider reason snapshot
  });

  it('§7/§26 cancelling a PERFORMED transaction is REFUND_DOMAIN_UNSUPPORTED — no -2, no state change', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    await create(txId, 'pm-1');
    await payme.recordPerform('pm-1', 222n);
    const res = await payme.recordCancel('pm-1', 5, 444n);
    expect(res).toMatchObject({ outcome: 'REFUND_DOMAIN_UNSUPPORTED', state: 2 });
    const row = (await prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId: 'pm-1' } }))!;
    expect(row.state).toBe(2); // still performed — never -2
    expect(row.cancelTimeMs).toBeNull();
  });

  it('§6 a cancelled (state -1) transaction cannot later be performed', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    await create(txId, 'pm-1');
    await payme.recordCancel('pm-1', 4, 333n);
    expect((await payme.recordPerform('pm-1', 555n)).outcome).toBe('NOT_PERFORMABLE');
  });

  it('§8/§23 CheckTransaction + GetStatement reconstruct native rows, ordered by Payme creation time within range', async () => {
    const a = await seedPendingAttempt('PAYME');
    const b = await seedPendingAttempt('PAYME');
    const c = await seedPendingAttempt('PAYME');
    await create(a.txId, 'pm-A', { providerCreatedTimeMs: 1000n });
    await create(b.txId, 'pm-B', { providerCreatedTimeMs: 3000n });
    await create(c.txId, 'pm-C', { providerCreatedTimeMs: 9000n }); // outside the query window
    await payme.recordPerform('pm-B', 3500n);

    const check = await payme.checkTransaction('pm-B');
    expect(check).toMatchObject({ state: 2, performTimeMs: 3500n, paymentTransactionId: b.txId });

    const statement = await payme.getStatement(500n, 5000n);
    expect(statement.map((r) => r.paymeTransactionId)).toEqual(['pm-A', 'pm-B']); // C excluded, ordered by creation time
  });

  it('§24 DB CHECKs guard Payme protocol integrity (state enum, positive tiyin, time/reason coherence)', async () => {
    const { txId } = await seedPendingAttempt('PAYME');
    const base = { paymentTransactionId: txId, paymeTransactionId: `pm-${uid()}`, amountTiyin: 9_600_000n, accountSnapshot: {}, providerCreatedTimeMs: 1000n, createTimeMs: 1000n, state: 1 };
    // invalid native state
    await expect(prisma.paymeMerchantTransaction.create({ data: { ...base, paymeTransactionId: `pm-${uid()}`, state: 5 } })).rejects.toThrow();
    // non-positive tiyin
    await expect(prisma.paymeMerchantTransaction.create({ data: { ...base, paymeTransactionId: `pm-${uid()}`, amountTiyin: 0n } })).rejects.toThrow();
    // time incoherent with state (state 1 must have NULL perform/cancel times)
    await expect(prisma.paymeMerchantTransaction.create({ data: { ...base, paymeTransactionId: `pm-${uid()}`, performTimeMs: 1n } })).rejects.toThrow();
    // reason present on a non-cancel state
    await expect(prisma.paymeMerchantTransaction.create({ data: { ...base, paymeTransactionId: `pm-${uid()}`, reason: 4 } })).rejects.toThrow();
    // a coherent state-1 row still persists
    const ok = await prisma.paymeMerchantTransaction.create({ data: { ...base, paymeTransactionId: `pm-${uid()}` }, select: { id: true } });
    expect(ok.id).toBeTruthy();
  });

  // ═══════════════════════════ CLICK protocol shell (§10/§11/§23, TD-233 — BLOCKER) ═══════════════════════════

  const D = (iso: string) => new Date(iso);

  it('§11 Prepare binds click_trans_id + a replay-stable merchant_prepare_id; PT stays PENDING (non-terminal)', async () => {
    const { orderId, txId } = await seedPendingAttempt('CLICK');
    const res = await click.recordPrepare({ paymentTransactionId: txId, clickTransId: 'ct-1', merchantPrepareId: 'mp-1', now: D('2026-08-21T10:00:00Z') });
    expect(res).toMatchObject({ outcome: 'PREPARED', clickTransId: 'ct-1', merchantPrepareId: 'mp-1', prepareState: ClickProtocolPhaseState.ACCEPTED });
    expect((await txn(txId))!.status).toBe('PENDING'); // non-terminal
    expect((await ord(orderId))!.status).toBe('PENDING');
    // replay keeps the ORIGINAL merchant_prepare_id even if a different one is offered
    const replay = await click.recordPrepare({ paymentTransactionId: txId, clickTransId: 'ct-1', merchantPrepareId: 'mp-OTHER', now: D('2026-08-21T11:00:00Z') });
    expect(replay).toMatchObject({ outcome: 'ALREADY_PREPARED', merchantPrepareId: 'mp-1' });
  });

  it('§11 Prepare conflicts: a different click_trans_id for the same attempt; the same id across two attempts (partial unique)', async () => {
    const a = await seedPendingAttempt('CLICK');
    await click.recordPrepare({ paymentTransactionId: a.txId, clickTransId: 'ct-1', merchantPrepareId: 'mp-1', now: D('2026-08-21T10:00:00Z') });
    expect((await click.recordPrepare({ paymentTransactionId: a.txId, clickTransId: 'ct-DIFF', merchantPrepareId: 'mp-1', now: D('2026-08-21T10:00:00Z') })).outcome).toBe('CONFLICT');
    const b = await seedPendingAttempt('CLICK');
    expect((await click.recordPrepare({ paymentTransactionId: b.txId, clickTransId: 'ct-1', merchantPrepareId: 'mp-2', now: D('2026-08-21T10:00:00Z') })).outcome).toBe('CONFLICT');
  });

  it('§23 Complete records a replay-stable merchant_confirm_id; requires an accepted Prepare first', async () => {
    const { txId } = await seedPendingAttempt('CLICK');
    // Complete before Prepare is refused
    expect((await click.recordComplete({ paymentTransactionId: txId, merchantConfirmId: 'mc-1', accepted: true, now: D('2026-08-21T10:00:00Z') })).outcome).toBe('NOT_PREPARED');
    await click.recordPrepare({ paymentTransactionId: txId, clickTransId: 'ct-1', merchantPrepareId: 'mp-1', now: D('2026-08-21T10:00:00Z') });
    const done = await click.recordComplete({ paymentTransactionId: txId, merchantConfirmId: 'mc-1', accepted: true, now: D('2026-08-21T10:05:00Z') });
    expect(done).toMatchObject({ outcome: 'COMPLETED', merchantConfirmId: 'mc-1', completeState: ClickProtocolPhaseState.ACCEPTED });
    const replay = await click.recordComplete({ paymentTransactionId: txId, merchantConfirmId: 'mc-OTHER', accepted: true, now: D('2026-08-21T10:10:00Z') });
    expect(replay).toMatchObject({ outcome: 'ALREADY_COMPLETED', merchantConfirmId: 'mc-1' }); // stable
  });

  it('§24 CLICK phase CHECK — an ACCEPTED Complete requires an ACCEPTED Prepare (direct DB)', async () => {
    const { txId } = await seedPendingAttempt('CLICK');
    await expect(prisma.clickShopTransaction.create({ data: { paymentTransactionId: txId, prepareState: 'PENDING', completeState: 'ACCEPTED' } })).rejects.toThrow();
    const ok = await prisma.clickShopTransaction.create({ data: { paymentTransactionId: txId, prepareState: 'ACCEPTED', completeState: 'ACCEPTED', clickTransId: 'ct-ok', merchantPrepareId: 'mp', merchantConfirmId: 'mc' }, select: { id: true } });
    expect(ok.id).toBeTruthy();
  });

  // ═══════════════════════════ Phase boundary (§25/§33) ═══════════════════════════

  it('§25/§33 protocol persistence + binding never touch core economic state or the provider port', async () => {
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    const cbSpy = jest.spyOn(providerAdapter, 'verifyCallback');
    const { orderId, txId } = await seedPendingAttempt('PAYME');
    const clickAttempt = await seedPendingAttempt('CLICK');
    const before = { tx: await prisma.paymentTransaction.count(), cb: await prisma.paymentCallbackEvent.count(), order: await prisma.paymentOrder.count(), sub: await prisma.subscription.count(), cycle: await prisma.subscriptionCycle.count(), ledger: await prisma.iZLLedgerEntry.count(), res: await prisma.iZLReservation.count() };

    await binding.bindProviderTransactionId(txId, PaymentProvider.PAYME, 'pm-x');
    await create(txId, 'pm-x2'); // note: binding + create are independent primitives here
    await payme.recordPerform('pm-x2', 222n); // protocol state 2 — but core PT is untouched
    await click.recordPrepare({ paymentTransactionId: clickAttempt.txId, clickTransId: 'ct-x', merchantPrepareId: 'mp-x', now: D('2026-08-21T10:00:00Z') });

    const after = { tx: await prisma.paymentTransaction.count(), cb: await prisma.paymentCallbackEvent.count(), order: await prisma.paymentOrder.count(), sub: await prisma.subscription.count(), cycle: await prisma.subscriptionCycle.count(), ledger: await prisma.iZLLedgerEntry.count(), res: await prisma.iZLReservation.count() };
    expect(after).toEqual(before); // no new PT / callback / order / subscription / cycle / ledger / reservation rows
    expect((await txn(txId))!.status).toBe('PENDING'); // performed at protocol level, PT still PENDING (no terminal transition)
    expect((await ord(orderId))!.status).toBe('PENDING');
    expect(initSpy).not.toHaveBeenCalled();
    expect(cbSpy).not.toHaveBeenCalled(); // no provider HTTP integration
  });
});
