import { Clock } from '../common/clock';
import { PaymeProtocolService } from './payme-protocol.service';
import type { PaymeProtocolRepository } from './payme-protocol.repository';

describe('PaymeProtocolService (Phase 2.1L-D §5 clock → integer Unix ms)', () => {
  const fixed = new Date('2026-08-21T10:00:00.000Z');
  const clock = { now: () => fixed } as Clock;
  const expectedMs = BigInt(fixed.getTime());

  it('createTransaction passes Clock.now() as an integer-ms BigInt nowMs', async () => {
    const recordCreate = jest.fn().mockResolvedValue({ outcome: 'CREATED' });
    const svc = new PaymeProtocolService({ recordCreate } as unknown as PaymeProtocolRepository, clock);
    await svc.createTransaction({ paymentTransactionId: 't', paymeTransactionId: 'p', providerCreatedTimeMs: 1n, amountTiyin: 100n, accountSnapshot: {} });
    expect(recordCreate).toHaveBeenCalledWith(expect.objectContaining({ nowMs: expectedMs }));
  });

  it('performTransaction / cancelTransaction stamp the same clock instant as integer-ms BigInt', async () => {
    const recordPerform = jest.fn().mockResolvedValue({ outcome: 'PERFORMED' });
    const recordCancel = jest.fn().mockResolvedValue({ outcome: 'CANCELLED' });
    const svc = new PaymeProtocolService({ recordPerform, recordCancel } as unknown as PaymeProtocolRepository, clock);
    await svc.performTransaction('p');
    await svc.cancelTransaction('p', 4);
    expect(recordPerform).toHaveBeenCalledWith('p', expectedMs);
    expect(recordCancel).toHaveBeenCalledWith('p', 4, expectedMs);
  });
});
