import { Module } from '@nestjs/common';
import { SMS_PORT, SmsPort } from './sms.port';
import { UnavailableSmsAdapter } from './adapters/unavailable-sms.adapter';
import { ConsoleSmsAdapter } from './adapters/console-sms.adapter';

/**
 * SmsModule — binds SMS_PORT. Default = production-safe UnavailableSmsAdapter (no real provider chosen).
 * SMS_DRIVER=console selects the DEV console adapter (§16) — but that is FORBIDDEN in production: the factory throws
 * at startup so a production process can never print OTP codes. Tests override SMS_PORT with TestSmsAdapter.
 */
function selectSmsAdapter(): SmsPort {
  const driver = (process.env.SMS_DRIVER ?? '').trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  if (driver === 'console') {
    if (nodeEnv === 'production') throw new Error('SMS_DRIVER=console is forbidden in production');
    return new ConsoleSmsAdapter();
  }
  return new UnavailableSmsAdapter();
}

@Module({
  providers: [{ provide: SMS_PORT, useFactory: selectSmsAdapter }],
  exports: [SMS_PORT],
})
export class SmsModule {}
