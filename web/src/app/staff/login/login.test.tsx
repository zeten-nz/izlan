import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import { DemoAccounts } from '@/components/shell/DemoAccounts';
import LoginPage from './page';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  setUser: vi.fn(),
  login: vi.fn(),
  requestOtp: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ status: 'unauthenticated', setAuthenticatedUser: h.setUser }) }));
vi.mock('@/lib/api/auth', () => ({ login: h.login, requestOtp: h.requestOtp, resetPassword: h.resetPassword }));

function renderPage() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <LoginPage />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('Staff login — phone + password (TD-252)', () => {
  beforeEach(() => {
    h.replace.mockReset();
    h.setUser.mockReset();
    h.login.mockReset();
    h.requestOtp.mockReset();
    h.resetPassword.mockReset();
    try {
      localStorage.clear(); // reset any persisted UI locale so each test starts at the default (uz)
    } catch {
      /* ignore */
    }
  });

  it('WEB-AUTH-PWD-01 primary login requires phone + password and submits them', async () => {
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    // phone + password present; NO OTP code field on the primary login
    fireEvent.change(screen.getByLabelText('Telefon raqami'), { target: { value: '+998901234567' } });
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Passw0rd!123' } });
    expect(screen.queryByLabelText('Tasdiqlash kodi')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Kirish/ }));
    await waitFor(() => expect(h.login).toHaveBeenCalledWith('+998901234567', 'Passw0rd!123'));
    await waitFor(() => expect(h.setUser).toHaveBeenCalledWith({ id: 'u1', onboardingCompleted: false }));
    expect(h.replace).toHaveBeenCalledWith('/staff/content');
  });

  it('WEB-AUTH-PWD-02 OTP is not part of the normal login submit', async () => {
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    fireEvent.change(screen.getByLabelText('Telefon raqami'), { target: { value: '+998901234567' } });
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirish/ }));
    await waitFor(() => expect(h.login).toHaveBeenCalled());
    expect(h.requestOtp).not.toHaveBeenCalled();
  });

  it('WEB-AUTH-PWD-03 password show/hide toggle is accessible', () => {
    renderPage();
    const input = screen.getByLabelText('Parol') as HTMLInputElement;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Parolni ko‘rsatish' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Parolni yashirish' })).toBeInTheDocument();
  });

  it('WEB-AUTH-PWD-05 wrong credentials show a generic localized error', async () => {
    h.login.mockRejectedValue(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'invalid'));
    renderPage();
    fireEvent.change(screen.getByLabelText('Telefon raqami'), { target: { value: '+998901234567' } });
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'nope-nope-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirish/ }));
    await waitFor(() => expect(screen.getByText('Telefon raqami yoki parol noto‘g‘ri.')).toBeInTheDocument());
  });

  it('WEB-AUTH-PWD-06 forgot-password opens the OTP recovery flow', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Parolni unutdingizmi?' }));
    expect(screen.getByText('Parolni tiklash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kod yuborish' })).toBeInTheDocument();
  });

  it('WEB-AUTH-PWD-07 uz/ru/en login chrome switches with locale', () => {
    renderPage();
    expect(screen.getByLabelText('Parol')).toBeInTheDocument(); // uz default
    fireEvent.change(screen.getByLabelText('Til'), { target: { value: 'ru' } });
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument(); // ru
    fireEvent.change(screen.getByLabelText('Язык'), { target: { value: 'en' } });
    expect(screen.getByLabelText('Password')).toBeInTheDocument(); // en
  });

  it('DEMO-WEB-01 demo helper is hidden by default (flag off in a normal build)', () => {
    renderPage(); // demoAccountsEnabled() is false unless NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS=true (never in production)
    expect(screen.queryByText('Demo akkauntlar')).toBeNull();
  });

  it('DEMO-WEB-02 when enabled, the demo helper shows the two demo phones', () => {
    render(
      <I18nProvider>
        <DemoAccounts onPick={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('Demo akkauntlar')).toBeInTheDocument();
    expect(screen.getByText('+998 90 000 00 01')).toBeInTheDocument();
    expect(screen.getByText('+998 90 000 00 02')).toBeInTheDocument();
  });

  it('DEMO-WEB-03 demo helper fills the phone ONLY (single phone arg) — never a password, never auto-login', () => {
    const onPick = vi.fn();
    render(
      <I18nProvider>
        <DemoAccounts onPick={onPick} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('Administrator').closest('button')!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('+998900000001'); // phone only; no password, no login side-effect
    expect(h.login).not.toHaveBeenCalled();
  });
});
