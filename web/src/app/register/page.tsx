'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { register as apiRegister, requestOtp } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthError, AuthField, AuthHeading, AuthInput, AuthPasswordInput } from '@/components/auth/fields';
import { OtpStep } from '@/components/auth/OtpStep';
import type { RailVariant } from '@/components/auth/AuthLearningRail';

const PW_MIN = 8;
const PW_MAX = 128;

type Step = 'phone' | 'otp' | 'password';

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const { status, setAuthenticatedUser } = useAuth();
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

  useEffect(() => {
    if (status === 'authenticated') router.replace('/learn');
  }, [status, router]);

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
      const res = await requestOtp(phone.trim(), 'REGISTRATION');
      setChallengeId(res.challengeId);
      startResendCountdown(res.resendAfter);
      setStep('otp');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  // No backend verify endpoint exists — advancing carries challengeId+code forward to the final register call.
  function confirmOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    setError(null);
    setStep('password');
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) return setError(t('authui.register.mismatch'));
    if (password.length < PW_MIN || password.length > PW_MAX) return setError(t('auth.policyShort'));
    setBusy(true);
    setError(null);
    try {
      const u = await apiRegister(challengeId, code.trim(), password); // password never trimmed; token kept in memory
      setAuthenticatedUser(u);
      router.replace('/onboarding'); // new learner always onboards next
    } catch (err) {
      setError(describeError(err, t));
      setBusy(false);
    }
  }

  const railVariant: RailVariant = step === 'phone' ? 'registerPhone' : step === 'otp' ? 'otp' : 'createPassword';

  return (
    <AuthShell rail={railVariant}>
      {step === 'phone' && (
        <>
          <AuthHeading title={t('authui.register.title')} subtitle={t('authui.register.subtitle')} />
          <form onSubmit={sendCode} className="mt-8 space-y-5" noValidate>
            <AuthField label={t('authui.phoneLabel')} htmlFor="phone" hint={t('authui.register.phoneHint')}>
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
              {t('authui.register.sendCode')}
            </AuthButton>
            <p className="text-center text-xs leading-relaxed text-muted">{t('authui.register.terms')}</p>
          </form>
          <p className="mt-6 text-center text-sm text-muted">
            {t('authui.register.haveAccount')}{' '}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              {t('authui.register.toLogin')}
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

      {step === 'password' && (
        <>
          <AuthHeading title={t('authui.register.pwTitle')} subtitle={t('authui.register.pwSubtitle')} />
          <form onSubmit={finish} className="mt-8 space-y-5" noValidate>
            <AuthField label={t('authui.passwordLabel')} htmlFor="password" hint={t('authui.register.pwHint')}>
              <AuthPasswordInput
                id="password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (error) setError(null);
                }}
                autoComplete="new-password"
                placeholder={t('authui.passwordPlaceholder')}
              />
            </AuthField>
            <AuthField label={t('authui.register.confirmLabel')} htmlFor="confirm">
              <AuthPasswordInput
                id="confirm"
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
              {t('authui.register.finish')}
            </AuthButton>
          </form>
        </>
      )}
    </AuthShell>
  );
}
