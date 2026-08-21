import { PaymentTransactionStatus } from '@prisma/client';
import { PaymentReopenRecoveryService } from './payment-reopen-recovery.service';
import type { ReopenBacklogItem, PaymentReopenRecoveryRepository } from './payment-reopen-recovery.repository';
import type { PaymentOrderReopenService } from './payment-order-reopen.service';
import type { PaymentReopenResult } from './payment-order-reopen.repository';

const item = (id: string): ReopenBacklogItem => ({ paymentOrderId: `o-${id}`, userId: `u-${id}`, terminalPaymentTransactionId: id, terminalStatus: PaymentTransactionStatus.FAILED, provider: 'CLICK', terminalAt: new Date('2026-08-20T07:00:00Z'), payableAmount: 96000, currency: 'UZS', discounted: false });
const ok = (outcome: PaymentReopenResult['outcome'], orderId = 'o'): PaymentReopenResult => ({ outcome, paymentTransactionId: 't', paymentOrderId: orderId });

describe('PaymentReopenRecoveryService (Phase 2.1K §44)', () => {
  const make = (items: ReopenBacklogItem[], reopen: jest.Mock) => {
    const repo = { backlogItems: jest.fn(async (l: number) => items.slice(0, l)), backlogCount: jest.fn(async () => items.length) } as unknown as PaymentReopenRecoveryRepository;
    const reopenSvc = { reopenAfterTerminalAttempt: reopen } as unknown as PaymentOrderReopenService;
    return { svc: new PaymentReopenRecoveryService(repo, reopenSvc), repo };
  };

  it('maps the 2.1J reopen outcomes into summary counts', async () => {
    const reopen = jest.fn()
      .mockResolvedValueOnce(ok('REOPENED'))
      .mockResolvedValueOnce(ok('ALREADY_REOPENED'))
      .mockResolvedValueOnce(ok('RETRY_ALREADY_IN_PROGRESS'))
      .mockResolvedValueOnce(ok('PAYMENT_SUCCESS_PENDING_FINALIZATION'))
      .mockResolvedValueOnce(ok('ALREADY_PAID'));
    const { svc } = make([item('a'), item('b'), item('c'), item('d'), item('e')], reopen);
    const s = await svc.reconcile();
    expect(s).toMatchObject({ scanned: 5, reopened: 1, alreadyReopened: 1, retryInProgress: 1, successPendingFinalization: 1, alreadyPaid: 1, failed: 0 });
  });

  it('an unexpected reopen error → FAILED with a safe code, others still processed (§55 isolation)', async () => {
    const reopen = jest.fn().mockRejectedValueOnce(new Error('boom SELECT prisma')).mockResolvedValueOnce(ok('REOPENED'));
    const { svc } = make([item('a'), item('b')], reopen);
    const s = await svc.reconcile();
    expect(s).toMatchObject({ scanned: 2, reopened: 1, failed: 1 });
    expect(s.items[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'INTERNAL_REOPEN_ERROR' });
    expect(JSON.stringify(s)).not.toContain('SELECT');
    expect(reopen).toHaveBeenCalledTimes(2);
  });

  it('§8 limit clamping: default 50, caps 200, invalid → default', async () => {
    const { svc, repo } = make([], jest.fn());
    await svc.reconcile(undefined);
    await svc.reconcile(1000);
    await svc.reconcile(0);
    await svc.reconcile(10);
    expect((repo.backlogItems as jest.Mock).mock.calls.map((c) => c[0])).toEqual([50, 200, 50, 10]);
  });

  it('listBacklog returns persisted facts + total, ISO terminalAt, no secrets', async () => {
    const { svc } = make([item('a')], jest.fn());
    const v = await svc.listBacklog(10);
    expect(v).toMatchObject({ total: 1, limit: 10 });
    expect(v.items[0]).toMatchObject({ paymentTransactionId: 'a', paymentOrderId: 'o-a', terminalStatus: 'FAILED', provider: 'CLICK', payableAmount: 96000, discounted: false });
    expect(v.items[0].terminalAt).toBe('2026-08-20T07:00:00.000Z');
  });
});
