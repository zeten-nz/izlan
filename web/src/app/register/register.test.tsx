import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import RegisterPage from './page';

const h = vi.hoisted(() => ({ replace: vi.fn(), setUser: vi.fn(), requestOtp: vi.fn(), register: vi.fn(), status: 'unauthenticated' as string }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ status: h.status, setAuthenticatedUser: h.setUser }) }));
vi.mock('@/lib/api/auth', () => ({ requestOtp: h.requestOtp, register: h.register }));

function renderPage() {
  return render(<ThemeProvider><I18nProvider><RegisterPage /></I18nProvider></ThemeProvider>);
}

/** Fill the 6 OTP boxes (one digit each) — exercises the shared OtpInput. */
function typeOtp(code = '123456') {
  const boxes = screen.getAllByRole('textbox');
  code.split('').forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
}

async function toOtpStep(phone = '+998900000003') {
  h.requestOtp.mockResolvedValue({ challengeId: 'c1', expiresIn: 180, resendAfter: 60 });
  fireEvent.change(screen.getByLabelText('Telefon raqam'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Kod yuborish' }));
  await screen.findByRole('group', { name: 'Tasdiqlash kodi' });
}

async function toPasswordStep(phone = '+998900000003', code = '123456') {
  await toOtpStep(phone);
  typeOtp(code);
  fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
  await screen.findByLabelText('Parolni tasdiqlang');
}

describe('Learner registration (WEB-REG)', () => {
  beforeEach(() => {
    for (const f of [h.replace, h.setUser, h.requestOtp, h.register]) f.mockReset();
    h.status = 'unauthenticated';
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
  });

  it('WEB-REG-08 an already-authenticated user (session restored on bootstrap) is redirected to /learn and does not see the wizard', async () => {
    h.status = 'authenticated';
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn'));
    expect(screen.queryByLabelText('Telefon raqam')).toBeNull();
  });

  it('WEB-REG-01 phone step requests a REGISTRATION OTP', async () => {
    renderPage();
    await toOtpStep();
    expect(h.requestOtp).toHaveBeenCalledWith('+998900000003', 'REGISTRATION');
  });

  it('WEB-REG-02 resend is disabled while the server cooldown is active', async () => {
    renderPage();
    await toOtpStep();
    // resendAfter=60 → the resend control is disabled (shows a countdown), not a free resend
    const resend = screen.getByRole('button', { name: /qayta yuborish/i });
    expect(resend).toBeDisabled();
  });

  it('WEB-REG-02b the OTP screen never calls a (nonexistent) verify endpoint — advancing is client-only', async () => {
    renderPage();
    await toOtpStep();
    typeOtp('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    await screen.findByLabelText('Parolni tasdiqlang');
    // Only requestOtp was hit; no verify call, and register waits for the password step.
    expect(h.requestOtp).toHaveBeenCalledTimes(1);
    expect(h.register).not.toHaveBeenCalled();
  });

  it('WEB-REG-03 a password mismatch is blocked locally (register not called)', async () => {
    renderPage();
    await toPasswordStep();
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tishni yakunlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Parollar mos kelmadi.'));
    expect(h.register).not.toHaveBeenCalled();
  });

  it('WEB-REG-04 a password shorter than 8 is rejected locally', async () => {
    renderPage();
    await toPasswordStep();
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tishni yakunlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(h.register).not.toHaveBeenCalled();
  });

  it('WEB-REG-05 the password is NOT trimmed, and the carried challengeId + code are submitted', async () => {
    h.register.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    await toPasswordStep();
    const pw = '  spaced pass  ';
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: pw } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: pw } });
    fireEvent.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tishni yakunlash' }));
    await waitFor(() => expect(h.register).toHaveBeenCalledWith('c1', '123456', pw));
  });

  it('WEB-REG-06 a successful registration does not persist the token to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    h.register.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    await toPasswordStep();
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'Passw0rd!123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tishni yakunlash' }));
    await waitFor(() => expect(h.setUser).toHaveBeenCalled());
    expect(setItem.mock.calls.some(([, v]) => typeof v === 'string' && v.includes('Passw0rd'))).toBe(false);
    setItem.mockRestore();
  });

  it('WEB-REG-07 a successful registration redirects to /onboarding', async () => {
    h.register.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    await toPasswordStep();
    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'Passw0rd!123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tishni yakunlash' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
  });
});
