'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiEye, FiEyeOff, FiMoon, FiSun } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useTheme } from '@/lib/theme/theme-context';
import { useT } from '@/lib/i18n/i18n-context';
import { login as apiLogin, requestOtp, resetPassword } from '@/lib/api/auth';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, IconButton, Input } from '@/components/ui';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { DemoAccounts } from '@/components/shell/DemoAccounts';
import { demoAccountsEnabled } from '@/lib/config/demo';

const PW_MIN = 8;
const PW_MAX = 128;

/** Password input with an accessible show/hide toggle. */
function PasswordInput({ id, value, onChange, autoComplete, placeholder }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted transition-colors hover:text-text"
      >
        {show ? <FiEyeOff aria-hidden /> : <FiEye aria-hidden />}
      </button>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { status, setAuthenticatedUser } = useAuth();
  const { resolved, toggle } = useTheme();
  const t = useT();
  const [mode, setMode] = useState<'login' | 'recover'>('login');

  useEffect(() => {
    if (status === 'authenticated') router.replace('/staff/content');
  }, [status, router]);

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

        {mode === 'login' ? <LoginForm onRecover={() => setMode('recover')} onAuthenticated={setAuthenticatedUser} router={router} /> : <RecoverForm onDone={() => setMode('login')} />}
      </Card>
    </div>
  );
}

function LoginForm({ onRecover, onAuthenticated, router }: { onRecover: () => void; onAuthenticated: (u: { id: string; onboardingCompleted: boolean }) => void; router: ReturnType<typeof useRouter> }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await apiLogin(phone.trim(), password); // password NOT trimmed
      onAuthenticated(me);
      router.replace('/staff/content');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t('auth.signIn')}>
      <Field label={t('auth.phone')} htmlFor="login-phone">
        <Input id="login-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </Field>
      <Field label={t('auth.password')} htmlFor="login-password" error={error} hint={t('auth.passwordHint')}>
        <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" placeholder={t('auth.passwordPlaceholder')} />
      </Field>
      <Button type="submit" loading={busy} className="w-full" disabled={phone.trim().length === 0 || password.length === 0}>
        {t('auth.signIn')} <FiArrowRight aria-hidden />
      </Button>
      <button type="button" onClick={onRecover} className="w-full text-center text-xs text-muted transition-colors hover:text-text">
        {t('auth.forgot')}
      </button>

      {demoAccountsEnabled() && <DemoAccounts onPick={setPhone} />}
    </form>
  );
}

function RecoverForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(phone.trim(), 'PASSWORD_RESET');
      setChallengeId(res.challengeId);
      setStep('code');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    if (password.length < PW_MIN || password.length > PW_MAX) {
      setError(t('auth.policyShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(challengeId, code.trim(), password);
      onDone(); // back to login (no auto-authenticate)
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text">{t('auth.recoveryTitle')}</h2>
        <p className="text-xs text-muted">{t('auth.recoverySubtitle')}</p>
      </div>
      {step === 'phone' ? (
        <form onSubmit={onRequest} className="space-y-4" aria-label={t('auth.recoveryTitle')}>
          <Field label={t('auth.phone')} htmlFor="recover-phone" error={error}>
            <Input id="recover-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Button type="submit" loading={busy} className="w-full" disabled={phone.trim().length === 0}>
            {t('auth.sendResetCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={onReset} className="space-y-4" aria-label={t('auth.resetSubmit')}>
          <Field label={t('auth.code')} htmlFor="recover-code">
            <Input id="recover-code" inputMode="numeric" autoComplete="one-time-code" placeholder={t('auth.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </Field>
          <Field label={t('auth.newPassword')} htmlFor="recover-password" hint={t('auth.passwordHint')}>
            <PasswordInput id="recover-password" value={password} onChange={setPassword} autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="recover-confirm" error={error}>
            <PasswordInput id="recover-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder={t('auth.passwordPlaceholder')} />
          </Field>
          <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6 || password.length < PW_MIN}>
            {t('auth.resetSubmit')}
          </Button>
        </form>
      )}
      <button type="button" onClick={onDone} className="w-full text-center text-xs text-muted transition-colors hover:text-text">
        {t('auth.backToLogin')}
      </button>
    </div>
  );
}
