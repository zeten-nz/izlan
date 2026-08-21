/**
 * SMS provider PORT (§18/19). Faqat abstraksiya — production adapter (Eskiz/PlayMobile/Twilio) YO'Q.
 * Vendor tiplari SmsModule'dan tashqariga chiqmaydi. Auth core provider-independent qoladi.
 * Development'da OTP'ni logga chiqaradigan adapter YO'Q.
 */

export const SMS_PORT = Symbol('SMS_PORT');

export type SmsSendResult = 'SENT' | 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE';

export interface SmsOtpMessage {
  canonicalPhone: string;
  code: string;
  purpose: string;
}

export interface SmsPort {
  sendOtp(message: SmsOtpMessage): Promise<SmsSendResult>;
}
