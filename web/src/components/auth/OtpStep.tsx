'use client';

import { useT } from '@/lib/i18n/i18n-context';
import { AuthButton, AuthError, AuthHeading } from './fields';
import { OtpInput } from './OtpInput';

/** Mask a phone for display: "+998901234567" → "+998 90 *** ** 67". Best-effort; falls back gracefully. */
export function maskPhone(raw: string): string {
  const s = (raw || '').trim();
  const d = s.replace(/\D/g, '');
  if (d.length >= 9) {
    const cc = d.slice(0, d.length - 9);
    const op = d.slice(d.length - 9, d.length - 7);
    const last2 = d.slice(-2);
    return `+${cc} ${op} *** ** ${last2}`.trim();
  }
  if (d.length > 4) return `${s.slice(0, 3)} *** ${d.slice(-2)}`;
  return s;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Shared OTP verification screen (registration + recovery). There is NO backend verify endpoint — the code is carried
 * forward in the caller's state and submitted with the final register/reset call. Submitting here just advances a step.
 */
export function OtpStep({
  phone,
  code,
  onCode,
  onBack,
  onResend,
  resendIn,
  busy,
  error,
  onSubmit,
}: {
  phone: string;
  code: string;
  onCode: (code: string) => void;
  onBack: () => void;
  onResend: () => void;
  resendIn: number;
  busy?: boolean;
  error?: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex text-[13px] font-semibold text-muted transition-colors hover:text-text"
      >
        {t('authui.otp.changeNumber')}
      </button>
      <AuthHeading title={t('authui.otp.title')} subtitle={t('authui.otp.subtitle', { phone: maskPhone(phone) })} />
      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <OtpInput value={code} onChange={onCode} autoFocus disabled={busy} />
        {error && <AuthError>{error}</AuthError>}
        <AuthButton type="submit" loading={busy} disabled={busy || code.length < 6}>
          {t('authui.otp.submit')}
        </AuthButton>
        <div className="text-center">
          <button
            type="button"
            onClick={onResend}
            disabled={busy || resendIn > 0}
            className="text-[13px] font-semibold text-primary transition-colors hover:underline disabled:text-muted disabled:no-underline disabled:hover:no-underline"
          >
            {resendIn > 0 ? t('authui.otp.resendIn', { time: formatCountdown(resendIn) }) : t('authui.otp.resend')}
          </button>
        </div>
      </form>
    </>
  );
}
