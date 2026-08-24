import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import ForgotPasswordPage from './page';

const h = vi.hoisted(() => ({ requestOtp: vi.fn(), resetPassword: vi.fn() }));
vi.mock('@/lib/api/auth', () => ({ requestOtp: h.requestOtp, resetPassword: h.resetPassword }));

function renderPage() {
  return render(<ThemeProvider><I18nProvider><ForgotPasswordPage /></I18nProvider></ThemeProvider>);
}

function typeOtp(code = '123456') {
  const boxes = screen.getAllByRole('textbox');
  code.split('').forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
}

async function toResetStep(phone = '+998900000003', code = '123456') {
  h.requestOtp.mockResolvedValue({ challengeId: 'c1', expiresIn: 180, resendAfter: 60 });
  fireEvent.change(screen.getByLabelText('Telefon raqam'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash kodini yuborish' }));
  await screen.findByRole('group', { name: 'Tasdiqlash kodi' });
  typeOtp(code);
  fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
  await screen.findByLabelText('Yangi parol');
}

describe('Learner password recovery (WEB-REC)', () => {
  beforeEach(() => { h.requestOtp.mockReset(); h.resetPassword.mockReset(); });

  it('WEB-REC-01 uses the PASSWORD_RESET OTP purpose', async () => {
    renderPage();
    h.requestOtp.mockResolvedValue({ challengeId: 'c1', expiresIn: 180, resendAfter: 60 });
    fireEvent.change(screen.getByLabelText('Telefon raqam'), { target: { value: '+998900000003' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash kodini yuborish' }));
    await screen.findByRole('group', { name: 'Tasdiqlash kodi' });
    expect(h.requestOtp).toHaveBeenCalledWith('+998900000003', 'PASSWORD_RESET');
  });

  it('WEB-REC-01b the OTP step does not verify server-side — reset is called only after the new-password step', async () => {
    renderPage();
    await toResetStep();
    expect(h.resetPassword).not.toHaveBeenCalled();
  });

  it('WEB-REC-02 an invalid OTP shows a friendly error', async () => {
    h.resetPassword.mockRejectedValue(new ApiError(400, 'AUTH_OTP_INVALID', 'x'));
    renderPage();
    await toResetStep('+998900000003', '000000');
    fireEvent.change(screen.getByLabelText('Yangi parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'Passw0rd!123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Parolni yangilash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kod noto‘g‘ri yoki muddati tugagan.'));
    expect(document.body.textContent).not.toContain('AUTH_OTP_INVALID');
  });

  it('WEB-REC-03 a too-short password is caught locally (reset not called)', async () => {
    renderPage();
    await toResetStep();
    fireEvent.change(screen.getByLabelText('Yangi parol'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Parolni yangilash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(h.resetPassword).not.toHaveBeenCalled();
  });

  it('WEB-REC-04/05 a successful reset shows a confirmation and does NOT auto-authenticate', async () => {
    h.resetPassword.mockResolvedValue({ status: 'ok' });
    renderPage();
    await toResetStep();
    fireEvent.change(screen.getByLabelText('Yangi parol'), { target: { value: 'Passw0rd!123' } });
    fireEvent.change(screen.getByLabelText('Parolni tasdiqlang'), { target: { value: 'Passw0rd!123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Parolni yangilash' }));
    await waitFor(() => expect(screen.getByText('Parol yangilandi')).toBeInTheDocument());
    // carried challengeId + code submitted; returns to login with no session established
    expect(h.resetPassword).toHaveBeenCalledWith('c1', '123456', 'Passw0rd!123');
    expect(screen.getByRole('link', { name: 'Kirishga qaytish' })).toHaveAttribute('href', '/login');
  });
});
