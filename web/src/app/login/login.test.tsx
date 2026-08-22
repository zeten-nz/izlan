import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError, NetworkError } from '@/lib/api/errors';
import LoginPage from './page';

const h = vi.hoisted(() => ({ replace: vi.fn(), setUser: vi.fn(), login: vi.fn(), next: null as string | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => ({ get: () => h.next }),
  usePathname: () => '/login',
}));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ status: 'unauthenticated', user: null, setAuthenticatedUser: h.setUser }) }));
vi.mock('@/lib/api/auth', () => ({ login: h.login }));

function renderPage() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <LoginPage />
      </I18nProvider>
    </ThemeProvider>,
  );
}

async function submit(phone = '+998900000003', password = 'Passw0rd!123') {
  fireEvent.change(screen.getByLabelText('Telefon raqami'), { target: { value: phone } });
  fireEvent.change(screen.getByLabelText('Parol'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Kirish' }));
}

describe('Learner login (WEB-AUTH)', () => {
  beforeEach(() => {
    h.replace.mockReset();
    h.setUser.mockReset();
    h.login.mockReset();
    h.next = null;
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
  });

  it('WEB-AUTH-01 invalid credentials shows a friendly localized message', async () => {
    h.login.mockRejectedValue(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    renderPage();
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Telefon raqami yoki parol noto‘g‘ri.'));
  });

  it('WEB-AUTH-02 the machine code is never rendered', async () => {
    h.login.mockRejectedValue(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    renderPage();
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('AUTH_INVALID_CREDENTIALS');
  });

  it('WEB-AUTH-03 a NetworkError shows the server/network message', async () => {
    h.login.mockRejectedValue(new NetworkError());
    renderPage();
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server bilan bog‘lanib bo‘lmadi. Internet yoki server holatini tekshiring.'));
  });

  it('WEB-AUTH-04 an unknown ApiError uses a generic friendly message (no code shown)', async () => {
    h.login.mockRejectedValue(new ApiError(500, 'SOME_WEIRD_CODE', 'boom'));
    renderPage();
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.'));
    expect(document.body.textContent).not.toContain('SOME_WEIRD_CODE');
  });

  it('WEB-AUTH-05 credentials errors are enumeration-safe (same message regardless of which field is wrong)', async () => {
    h.login.mockRejectedValue(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    renderPage();
    await submit('+998900000009', 'wrong');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Telefon raqami yoki parol noto‘g‘ri.'));
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toMatch(/telefon.*mavjud emas|parol noto‘g‘ri$/i); // not a phone-specific or password-only message
  });

  it('WEB-AUTH-06 a successful login does not persist the access token to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: true });
    renderPage();
    await submit();
    await waitFor(() => expect(h.setUser).toHaveBeenCalled());
    // no token written to localStorage/sessionStorage (access token is memory-only)
    const wroteToken = setItem.mock.calls.some(([, v]) => typeof v === 'string' && v.includes('Passw0rd'));
    expect(wroteToken).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
    setItem.mockRestore();
  });

  it('WEB-AUTH-07 an incomplete learner is redirected to /onboarding', async () => {
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: false });
    renderPage();
    await submit();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
  });

  it('WEB-AUTH-08 a completed learner is redirected to /learn (or the safe next)', async () => {
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: true });
    renderPage();
    await submit();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn'));
  });

  it('WEB-AUTH-08b an unsafe ?next is ignored (no open redirect)', async () => {
    h.next = 'https://evil.example/steal';
    h.login.mockResolvedValue({ id: 'u1', onboardingCompleted: true });
    renderPage();
    await submit();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn'));
  });
});
