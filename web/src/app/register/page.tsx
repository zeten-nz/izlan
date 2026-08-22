'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiCheck } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { register as apiRegister, requestOtp } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, Input } from '@/components/ui';
import { PublicHeader } from '@/components/learner/PublicHeader';
import { PasswordInput } from '@/components/learner/PasswordInput';

const PW_MIN = 8;
const PW_MAX = 128;

/** Progress indicator for the auth wizards. */
function Steps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="progress">
      {steps.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              i < active ? 'bg-primary text-primary-fg' : i === active ? 'border-2 border-primary text-primary' : 'border border-border text-muted'
            }`}
          >
            {i < active ? <FiCheck aria-hidden /> : i + 1}
          </span>
          <span className={`truncate text-xs ${i === active ? 'font-medium text-text' : 'text-muted'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const { status, setAuthenticatedUser } = useAuth();
  const [step, setStep] = useState<0 | 1>(0);
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
      setStep(1);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) return setError(t('learner.register.mismatch'));
    if (password.length < PW_MIN || password.length > PW_MAX) return setError(t('auth.policyShort'));
    setBusy(true);
    setError(null);
    try {
      const u = await apiRegister(challengeId, code.trim(), password); // password never trimmed; stores token in memory
      setAuthenticatedUser(u);
      router.replace('/onboarding'); // new learner always onboards next
    } catch (err) {
      setError(describeError(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <PublicHeader />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{t('learner.register.title')}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{t('learner.register.subtitle')}</p>
          <Steps steps={[t('learner.register.stepPhone'), t('learner.register.stepVerify'), t('learner.register.stepDone')]} active={step} />

          {step === 0 ? (
            <form onSubmit={sendCode} className="space-y-4" noValidate>
              <Field label={t('auth.phone')} htmlFor="phone" hint={t('auth.phoneHint')}>
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </Field>
              {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} disabled={busy || !phone.trim()} className="w-full">{t('learner.register.sendCode')}</Button>
            </form>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <p className="text-sm text-muted">{t('learner.register.codeSentTo', { phone: phone.trim() })}</p>
              <Field label={t('auth.code')} htmlFor="code">
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" placeholder={t('auth.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value)} required />
              </Field>
              <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')}>
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} />
              </Field>
              <Field label={t('auth.confirmPassword')} htmlFor="confirm">
                <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} />
              </Field>
              {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" loading={busy} disabled={busy} className="w-full">{t('learner.register.createAccount')}</Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => { setStep(0); setError(null); }} className="text-muted transition-colors hover:text-text">
                  {t('learner.register.changePhone')}
                </button>
                <button type="button" onClick={() => sendCode()} disabled={resendIn > 0 || busy} className="text-primary hover:underline disabled:text-muted disabled:no-underline">
                  {resendIn > 0 ? t('learner.register.resendIn', { n: resendIn }) : t('learner.register.resend')}
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            {t('learner.register.haveAccount')}{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">{t('learner.register.toLogin')}</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
