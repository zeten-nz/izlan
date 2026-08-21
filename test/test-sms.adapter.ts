import { Injectable } from '@nestjs/common';
import { SmsPort, SmsSendResult, SmsOtpMessage } from '../src/sms/sms.port';

/**
 * TEST-ONLY SMS adapter (§20/47). test/ papkada — production build/module TASODIFAN tanlamaydi.
 * Test module override orqali SMS_PORT'ga bind qilinadi. OTP faqat XOTIRADA (log/persist YO'Q).
 */
@Injectable()
export class TestSmsAdapter implements SmsPort {
  private readonly messages: SmsOtpMessage[] = [];

  async sendOtp(message: SmsOtpMessage): Promise<SmsSendResult> {
    this.messages.push(message);
    return 'SENT';
  }

  latestCode(): string | undefined {
    return this.messages.at(-1)?.code;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

/** Fail simulyatsiyasi uchun (SMS delivery fail testi). */
@Injectable()
export class FailingSmsAdapter implements SmsPort {
  async sendOtp(): Promise<SmsSendResult> {
    return 'TEMPORARY_FAILURE';
  }
}
