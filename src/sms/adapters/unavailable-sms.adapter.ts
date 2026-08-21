import { Injectable } from '@nestjs/common';
import { SmsPort, SmsSendResult } from '../sms.port';

/**
 * Production default (§20/59). Real SMS provider TANLANMAGAN → standart TEMPORARY_FAILURE.
 * OTP HECH QACHON log qilinmaydi/saqlanmaydi. Provider tanlanganda adapter almashtiriladi.
 */
@Injectable()
export class UnavailableSmsAdapter implements SmsPort {
  async sendOtp(): Promise<SmsSendResult> {
    return 'TEMPORARY_FAILURE';
  }
}
