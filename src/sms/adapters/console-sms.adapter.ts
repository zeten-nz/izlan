import { Injectable, Logger } from '@nestjs/common';
import { SmsOtpMessage, SmsPort, SmsSendResult } from '../sms.port';

/**
 * DEVELOPMENT-ONLY SMS adapter (§16, TD-252). Selected via SMS_DRIVER=console; FORBIDDEN in production (the SmsModule
 * factory throws at startup if NODE_ENV=production). Prints ONLY phone + purpose + the OTP code — never a session,
 * token, hash, or pepper. For registration / password-reset flows when no real SMS provider is configured yet.
 */
@Injectable()
export class ConsoleSmsAdapter implements SmsPort {
  private readonly logger = new Logger('DevSms');

  async sendOtp(message: SmsOtpMessage): Promise<SmsSendResult> {
    this.logger.warn(`[IZLAN DEV SMS] phone=${message.canonicalPhone} purpose=${message.purpose} code=${message.code}`);
    return 'SENT';
  }
}
