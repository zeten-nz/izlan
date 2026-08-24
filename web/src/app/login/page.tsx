'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { login as apiLogin } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthError, AuthField, AuthHeading, AuthInput, AuthPasswordInput } from '@/components/auth/fields';
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

  const nextParam = params.get('next');
  const registerHref = nextParam ? `/register?next=${encodeURIComponent(safeLearnerNext(nextParam))}` : '/register';

  return (
    <>
      <AuthHeading title={t('authui.login.title')} subtitle={t('authui.login.subtitle')} />

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
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

        <AuthField
          label={t('authui.passwordLabel')}
          htmlFor="password"
          trailing={
            <Link href="/forgot-password" className="text-[13px] font-semibold text-primary hover:underline">
              {t('authui.login.forgot')}
            </Link>
          }
        >
          <AuthPasswordInput
            id="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            autoComplete="current-password"
            placeholder={t('authui.passwordPlaceholder')}
          />
        </AuthField>

        {error && <AuthError>{error}</AuthError>}

        <AuthButton type="submit" loading={busy} disabled={busy}>
          {t('authui.login.submit')}
        </AuthButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {t('authui.login.noAccount')}{' '}
        <Link href={registerHref} className="font-semibold text-primary hover:underline">
          {t('authui.login.register')}
        </Link>
      </p>

      {demoAccountsEnabled() && <DemoAccounts accounts={DEMO_LEARNER_ACCOUNTS} onPick={setPhone} />}
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell rail="login">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
