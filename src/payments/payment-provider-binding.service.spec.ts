import { PaymentProvider } from '@prisma/client';
import { PaymentProviderBindingService } from './payment-provider-binding.service';
import type { PaymentProviderBindingRepository, ProviderBindingResult } from './payment-provider-binding.repository';

describe('PaymentProviderBindingService (Phase 2.1L-D §17)', () => {
  it('delegates to the repository bind() unchanged', async () => {
    const result: ProviderBindingResult = { outcome: 'BOUND', paymentTransactionId: 't', provider: PaymentProvider.PAYME, providerTransactionId: 'p' };
    const bind = jest.fn().mockResolvedValue(result);
    const svc = new PaymentProviderBindingService({ bind } as unknown as PaymentProviderBindingRepository);
    expect(await svc.bindProviderTransactionId('t', PaymentProvider.PAYME, 'p')).toBe(result);
    expect(bind).toHaveBeenCalledWith('t', PaymentProvider.PAYME, 'p');
  });
});
