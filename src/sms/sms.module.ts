import { Module } from '@nestjs/common';
import { SMS_PORT } from './sms.port';
import { UnavailableSmsAdapter } from './adapters/unavailable-sms.adapter';

/**
 * SmsModule — SMS_PORT'ni production default UnavailableSmsAdapter'ga bind qiladi (§20).
 * Real provider (Eskiz/PlayMobile/Twilio) TANLANMAGAN. Test'lar SMS_PORT'ni test module override
 * orqali TestSmsAdapter bilan almashtiradi (NODE_ENV typo'ga bog'liq emas, §47).
 */
@Module({
  providers: [{ provide: SMS_PORT, useClass: UnavailableSmsAdapter }],
  exports: [SMS_PORT],
})
export class SmsModule {}
