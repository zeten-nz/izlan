'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiMoon, FiSun } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useTheme } from '@/lib/theme/theme-context';
import { useT } from '@/lib/i18n/i18n-context';
import { requestOtp, verifyOtp } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, IconButton, Input } from '@/components/ui';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';

export default function LoginPage() {
  const router = useRouter();
  const { status, setAuthenticatedUser } = useAuth();
  const { resolved, toggle } = useTheme();
  const t = useT();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/staff/content');
  }, [status, router]);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(phone.trim());
      setChallengeId(res.challengeId);
      setStep('code');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await verifyOtp(challengeId, code.trim());
      setAuthenticatedUser(user);
      router.replace('/staff/content');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="izl-grid-bg grid min-h-screen place-items-center bg-bg p-4">
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <LocaleSwitcher />
        <IconButton label={resolved === 'dark' ? t('theme.toLight') : t('theme.toDark')} onClick={toggle}>
          {resolved === 'dark' ? <FiSun aria-hidden /> : <FiMoon aria-hidden />}
        </IconButton>
      </div>
      <Card className="izl-elevate w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-fg">Iz</span>
          <div>
            <h1 className="text-lg font-bold text-text">{t('auth.title')}</h1>
            <p className="text-xs text-muted">{t('auth.subtitle')}</p>
          </div>
        </div>

        {step === 'phone' ? (
          <form onSubmit={onRequest} className="space-y-4">
            <Field label={t('auth.phone')} htmlFor="phone" error={error} hint={t('auth.phoneHint')}>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            <Button type="submit" loading={busy} className="w-full" disabled={phone.trim().length === 0}>
              {t('auth.getCode')} <FiArrowRight aria-hidden />
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <Field label={t('auth.code')} htmlFor="code" error={error} hint={t('auth.codeHint', { phone })}>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('auth.codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </Field>
            <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>
              {t('auth.signIn')}
            </Button>
            <button type="button" onClick={() => setStep('phone')} className="w-full text-center text-xs text-muted transition-colors hover:text-text">
              {t('auth.changeNumber')}
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
