'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FiCheckCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { requestOtp, resetPassword } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthError, AuthField, AuthHeading, AuthInput, AuthPasswordInput } from '@/components/auth/fields';
import { OtpStep } from '@/components/auth/OtpStep';
import type { RailVariant } from '@/components/auth/AuthLearningRail';

const PW_MIN = 8;
const PW_MAX = 128;

type Step = 'phone' | 'otp' | 'reset' | 'done';

export default function ForgotPasswordPage() {
  const t = useT();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function startResendCountdown(seconds: number) {
    setResendIn(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setResendIn((s) => (s <= 1 ? (clearInterval(timer.current!), 0) : s - 1)), 1000);
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(phone.trim(), 'PASSWORD_RESET');
      setChallengeId(res.challengeId);
      startResendCountdown(res.resendAfter);
      setStep('otp');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  // No backend verify endpoint — carry challengeId+code forward to the final resetPassword call.
  function confirmOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    setError(null);
    setStep('reset');
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) return setError(t('authui.register.mismatch'));
    if (password.length < PW_MIN || password.length > PW_MAX) return setError(t('auth.policyShort'));
    setBusy(true);
    setError(null);
    try {
      await resetPassword(challengeId, code.trim(), password); // does NOT auto-login (server returns no token)
      setStep('done');
    } catch (err) {
      setError(describeError(err, t));
      setBusy(false);
    }
  }

  const railVariant: RailVariant =
    step === 'phone' ? 'forgot' : step === 'otp' ? 'otp' : step === 'reset' ? 'createPassword' : 'resetSuccess';

  return (
    <AuthShell rail={railVariant}>
      {step === 'phone' && (
        <>
          <AuthHeading title={t('authui.forgot.title')} subtitle={t('authui.forgot.subtitle')} />
          <form onSubmit={sendCode} className="mt-8 space-y-5" noValidate>
            <AuthField label={t('authui.phoneLabel')} htmlFor="phone">
              <AuthInput
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('authui.phonePlaceholder')}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                required
              />
            </AuthField>
            {error && <AuthError>{error}</AuthError>}
            <AuthButton type="submit" loading={busy} disabled={busy || !phone.trim()}>
              {t('authui.forgot.sendCode')}
            </AuthButton>
          </form>
          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="font-semibold text-primary hover:underline">
              {t('authui.forgot.backToLogin')}
            </Link>
          </p>
        </>
      )}

      {step === 'otp' && (
        <OtpStep
          phone={phone}
          code={code}
          onCode={(c) => {
            setCode(c);
            if (error) setError(null);
          }}
          onBack={() => {
            setStep('phone');
            setError(null);
          }}
          onResend={() => sendCode()}
          resendIn={resendIn}
          busy={busy}
          error={error}
          onSubmit={confirmOtp}
        />
      )}

      {step === 'reset' && (
        <>
          <AuthHeading title={t('authui.reset.title')} subtitle={t('authui.reset.subtitle')} />
          <form onSubmit={submitReset} className="mt-8 space-y-5" noValidate>
            <AuthField label={t('authui.reset.newPassword')} htmlFor="newpw" hint={t('authui.register.pwHint')}>
              <AuthPasswordInput
                id="newpw"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (error) setError(null);
                }}
                autoComplete="new-password"
                placeholder={t('authui.passwordPlaceholder')}
              />
            </AuthField>
            <AuthField label={t('authui.reset.confirmLabel')} htmlFor="confirmpw">
              <AuthPasswordInput
                id="confirmpw"
                value={confirm}
                onChange={(v) => {
                  setConfirm(v);
                  if (error) setError(null);
                }}
                autoComplete="new-password"
                placeholder={t('authui.passwordPlaceholder')}
              />
            </AuthField>
            {error && <AuthError>{error}</AuthError>}
            <AuthButton type="submit" loading={busy} disabled={busy}>
              {t('authui.reset.submit')}
            </AuthButton>
          </form>
        </>
      )}

      {step === 'done' && (
        <div className="text-center">
          <FiCheckCircle className="mx-auto text-5xl text-success" aria-hidden />
          <h1 className="mt-5 text-[26px] font-extrabold leading-tight tracking-tight text-text">
            {t('authui.reset.successTitle')}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{t('authui.reset.successBody')}</p>
          <Link
            href="/login"
            className="mt-8 inline-flex h-[52px] w-full items-center justify-center rounded-[10px] bg-primary text-[15px] font-bold text-primary-fg transition-[background-color] hover:bg-primary-600"
          >
            {t('authui.reset.backToLogin')}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
