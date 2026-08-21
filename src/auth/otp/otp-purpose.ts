/**
 * OTP purpose (§16). Schema OtpChallenge.purpose = String; bu application constant.
 * PHONE_CHANGE strukturaviy qo'llab-quvvatlanadi, lekin flow 1.4B'da implement QILINMAYDI (§61).
 */
export const OtpPurpose = {
  LOGIN: 'LOGIN',
  PHONE_CHANGE: 'PHONE_CHANGE',
} as const;

export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
