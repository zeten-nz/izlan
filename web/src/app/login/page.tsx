'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { login as apiLogin } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, Input } from '@/components/ui';
import { PublicHeader } from '@/components/learner/PublicHeader';
import { PasswordInput } from '@/components/learner/PasswordInput';
import { DemoAccounts } from '@/components/shell/DemoAccounts';
import { demoAccountsEnabled, DEMO_LEARNER_ACCOUNTS } from '@/lib/config/demo';
import { postAuthLearnerPath, safeLearnerNext } from '@/lib/learner/nav';

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { status, user, setAuthenticatedUser } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already authenticated → leave the auth pages.
  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(postAuthLearnerPath(user.onboardingCompleted, params.get('next')));
  }, [status, user, router, params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const u = await apiLogin(phone.trim(), password); // password never trimmed
      setAuthenticatedUser(u);
      router.replace(postAuthLearnerPath(u.onboardingCompleted, params.get('next')));
    } catch (err) {
      setError(describeError(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('learner.login.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('learner.login.subtitle')}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label={t('auth.phone')} htmlFor="phone">
            <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder={t('auth.passwordPlaceholder')} />
          </Field>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" loading={busy} disabled={busy} className="w-full">
            {t('learner.login.submit')}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-muted transition-colors hover:text-text">
            {t('learner.login.forgot')}
          </Link>
          <span className="text-muted">
            {t('learner.login.noAccount')}{' '}
            <Link href={`/register${params.get('next') ? `?next=${encodeURIComponent(safeLearnerNext(params.get('next')))}` : ''}`} className="font-medium text-primary hover:underline">
              {t('learner.login.register')}
            </Link>
          </span>
        </div>

        {demoAccountsEnabled() && <DemoAccounts accounts={DEMO_LEARNER_ACCOUNTS} onPick={setPhone} />}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <PublicHeader />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
