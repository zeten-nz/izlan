import { SubscriptionPurchaseActiveConflictError, PaymentFinalizationIntegrityError } from '../common/errors';
import { PaymentFinalizationRecoveryService } from './payment-finalization-recovery.service';
import type { BacklogItem, PaymentFinalizationRecoveryRepository } from './payment-finalization-recovery.repository';
import type { PaymentFinalizationService } from './payment-finalization.service';
import type { FinalizationResult } from './payment-finalization.repository';

const item = (id: string, orderId = `o-${id}`): BacklogItem => ({ paymentTransactionId: id, paymentOrderId: orderId, userId: `u-${id}`, confirmedAt: new Date('2026-08-20T07:00:00Z'), payableAmount: 96000, currency: 'UZS', discounted: false });
const result = (orderId: string, replay: boolean): FinalizationResult => ({ paymentOrderId: orderId, paymentTransactionId: 't', userId: 'u', subscriptionId: 's', subscriptionCycleId: 'c', status: 'PAID', discounted: false, replay });

describe('PaymentFinalizationRecoveryService (Phase 2.1H §50)', () => {
  const makeService = (items: BacklogItem[], finalize: jest.Mock) => {
    const repo = { backlogItems: jest.fn(async (limit: number) => items.slice(0, limit)), backlogCount: jest.fn(async () => items.length) } as unknown as PaymentFinalizationRecoveryRepository;
    const finalization = { finalizeVerifiedPayment: finalize } as unknown as PaymentFinalizationService;
    return { svc: new PaymentFinalizationRecoveryService(repo, finalization), repo, finalization };
  };

  it('classifies FINALIZED (fresh) and ALREADY_FINALIZED (replay)', async () => {
    const finalize = jest.fn().mockResolvedValueOnce(result('o-a', false)).mockResolvedValueOnce(result('o-b', true));
    const { svc } = makeService([item('a'), item('b')], finalize);
    const s = await svc.reconcile();
    expect(s).toMatchObject({ scanned: 2, finalized: 1, alreadyFinalized: 1, blocked: 0, failed: 0 });
    expect(s.items.map((i) => i.outcome)).toEqual(['FINALIZED', 'ALREADY_FINALIZED']);
  });

  it('classifies BLOCKED (active conflict) with a stable reason code, not FAILED', async () => {
    const finalize = jest.fn().mockRejectedValue(new SubscriptionPurchaseActiveConflictError('x'));
    const { svc } = makeService([item('a')], finalize);
    const s = await svc.reconcile();
    expect(s).toMatchObject({ blocked: 1, failed: 0 });
    expect(s.items[0]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'SUBSCRIPTION_PURCHASE_ACTIVE_CONFLICT' });
  });

  it('classifies any other finalizer error as FAILED with a safe code (no leak)', async () => {
    const finalize = jest.fn().mockRejectedValue(new PaymentFinalizationIntegrityError('SELECT * corrupt'));
    const { svc } = makeService([item('a')], finalize);
    const s = await svc.reconcile();
    expect(s.items[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'INTERNAL_FINALIZATION_ERROR' });
    expect(JSON.stringify(s)).not.toContain('SELECT');
  });

  it('§30/§31 item isolation: one blocked + one failed do not stop a later valid item', async () => {
    const finalize = jest.fn()
      .mockRejectedValueOnce(new SubscriptionPurchaseActiveConflictError('x')) // A blocked
      .mockRejectedValueOnce(new Error('boom')) // B failed
      .mockResolvedValueOnce(result('o-c', false)); // C finalized
    const { svc } = makeService([item('a'), item('b'), item('c')], finalize);
    const s = await svc.reconcile();
    expect(s).toMatchObject({ scanned: 3, finalized: 1, blocked: 1, failed: 1 });
    expect(s.items.map((i) => i.outcome)).toEqual(['BLOCKED', 'FAILED', 'FINALIZED']);
    expect(finalize).toHaveBeenCalledTimes(3);
  });

  it('§6 limit clamping: default 50, caps at 200, rejects non-positive/non-integer → default', async () => {
    const finalize = jest.fn();
    const { svc, repo } = makeService([], finalize);
    await svc.reconcile(undefined);
    await svc.reconcile(1000);
    await svc.reconcile(0);
    await svc.reconcile(3.5);
    await svc.reconcile(10);
    expect((repo.backlogItems as jest.Mock).mock.calls.map((c) => c[0])).toEqual([50, 200, 50, 50, 10]);
  });

  it('listBacklog returns persisted facts + total, ISO confirmedAt, no secrets', async () => {
    const finalize = jest.fn();
    const { svc } = makeService([item('a')], finalize);
    const v = await svc.listBacklog(10);
    expect(v).toMatchObject({ total: 1, limit: 10 });
    expect(v.items[0]).toMatchObject({ paymentTransactionId: 'a', paymentOrderId: 'o-a', userId: 'u-a', payableAmount: 96000, currency: 'UZS', discounted: false });
    expect(v.items[0].confirmedAt).toBe('2026-08-20T07:00:00.000Z');
    expect(finalize).not.toHaveBeenCalled(); // read-only
  });
});
