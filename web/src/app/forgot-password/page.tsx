'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FiCheckCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { requestOtp, resetPassword } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, Input } from '@/components/ui';
import { PublicHeader } from '@/components/learner/PublicHeader';
import { PasswordInput } from '@/components/learner/PasswordInput';

const PW_MIN = 8;
const PW_MAX = 128;

export default function ForgotPasswordPage() {
  const t = useT();
  const [step, setStep] = useState<'phone' | 'reset' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(phone.trim(), 'PASSWORD_RESET');
      setChallengeId(res.challengeId);
      setStep('reset');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < PW_MIN || password.length > PW_MAX) return setError(t('auth.policyShort'));
    setBusy(true);
    setError(null);
    try {
      await resetPassword(challengeId, code.trim(), password); // does NOT auto-login (server returns no token)
      setStep('done');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <PublicHeader />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <Card className="p-6 sm:p-8">
          {step === 'done' ? (
            <div className="text-center">
              <FiCheckCircle className="mx-auto text-4xl text-success" aria-hidden />
              <p className="mt-4 text-text">{t('learner.forgot.done')}</p>
              <Link href="/login" className="mt-6 inline-block">
                <Button>{t('learner.forgot.backToLogin')}</Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">{t('learner.forgot.title')}</h1>
              <p className="mb-6 mt-1 text-sm text-muted">{t('learner.forgot.subtitle')}</p>

              {step === 'phone' ? (
                <form onSubmit={sendCode} className="space-y-4" noValidate>
                  <Field label={t('auth.phone')} htmlFor="phone" hint={t('auth.phoneHint')}>
                    <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
                  </Field>
                  {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
                  <Button type="submit" loading={busy} disabled={busy || !phone.trim()} className="w-full">{t('learner.forgot.sendCode')}</Button>
                </form>
              ) : (
                <form onSubmit={submit} className="space-y-4" noValidate>
                  <h2 className="text-sm font-medium">{t('learner.forgot.resetTitle')}</h2>
                  <p className="text-sm text-muted">{t('learner.register.codeSentTo', { phone: phone.trim() })}</p>
                  <Field label={t('auth.code')} htmlFor="code">
                    <Input id="code" inputMode="numeric" autoComplete="one-time-code" placeholder={t('auth.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value)} required />
                  </Field>
                  <Field label={t('auth.newPassword')} htmlFor="newpw" hint={t('auth.passwordHint')}>
                    <PasswordInput id="newpw" value={password} onChange={setPassword} autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} />
                  </Field>
                  {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
                  <Button type="submit" loading={busy} disabled={busy} className="w-full">{t('learner.forgot.submit')}</Button>
                </form>
              )}

              <p className="mt-6 text-center text-sm">
                <Link href="/login" className="text-muted transition-colors hover:text-text">{t('learner.forgot.backToLogin')}</Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
