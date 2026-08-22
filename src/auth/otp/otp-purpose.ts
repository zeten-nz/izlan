/**
 * OTP purpose (§9, TD-252). Schema OtpChallenge.purpose = String; this is the application constant.
 * After the phone+password amendment OTP is NO LONGER a login mechanism — it verifies phone ownership for
 * REGISTRATION and PASSWORD_RESET (and structurally PHONE_CHANGE). Purpose-scoped verification isolates flows.
 */
export const OtpPurpose = {
  REGISTRATION: 'REGISTRATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PHONE_CHANGE: 'PHONE_CHANGE',
} as const;

export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

/** Purposes a public, unauthenticated caller may request an OTP for. */
export const PUBLIC_OTP_PURPOSES: readonly string[] = [OtpPurpose.REGISTRATION, OtpPurpose.PASSWORD_RESET];
