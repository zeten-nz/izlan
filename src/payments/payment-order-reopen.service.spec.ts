import { PaymentOrderReopenService } from './payment-order-reopen.service';
import type { PaymentOrderReopenRepository, PaymentReopenResult } from './payment-order-reopen.repository';

describe('PaymentOrderReopenService (Phase 2.1J §67)', () => {
  const make = (reopen: jest.Mock) => new PaymentOrderReopenService({ reopen } as unknown as PaymentOrderReopenRepository);

  it('reopenAfterTerminalAttempt delegates to the repository', async () => {
    const result: PaymentReopenResult = { outcome: 'REOPENED', paymentTransactionId: 't', paymentOrderId: 'o' };
    const reopen = jest.fn().mockResolvedValue(result);
    expect(await make(reopen).reopenAfterTerminalAttempt('t')).toBe(result);
    expect(reopen).toHaveBeenCalledWith('t');
  });

  it('tryReopenAfterTerminal is non-throwing — a repository failure never propagates (§25)', async () => {
    const reopen = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(make(reopen).tryReopenAfterTerminal('t')).resolves.toBeUndefined();
  });
});
