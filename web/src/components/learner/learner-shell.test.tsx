import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { LearnerShell } from './LearnerShell';

const h = vi.hoisted(() => ({ pathname: '/learn/today', logout: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ logout: h.logout }) }));

function renderShell() {
  return render(<ThemeProvider><I18nProvider><LearnerShell><p>content</p></LearnerShell></I18nProvider></ThemeProvider>);
}

describe('LearnerShell (WEB-SHELL)', () => {
  beforeEach(() => { h.pathname = '/learn/today'; h.logout.mockReset(); h.replace.mockReset(); h.logout.mockResolvedValue(undefined); });

  it('WEB-SHELL-01 renders the coherent 3-item learner IA: Today / Roadmap / Results', () => {
    renderShell();
    for (const label of ['Bugun', 'Yo‘l xaritasi', 'Natijalar']) {
      expect(screen.getAllByText((c) => c.startsWith(label)).length).toBeGreaterThan(0);
    }
    // Execution surfaces are reached FROM Today, not as separate nav destinations.
    expect(screen.queryByRole('link', { name: 'O‘rganish' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Takrorlash' })).toBeNull();
  });

  it('WEB-SHELL-02 Today is the active route on /learn/today, and links to the canonical home', () => {
    h.pathname = '/learn/today';
    renderShell();
    const today = screen.getAllByRole('link', { name: 'Bugun' });
    expect(today[0]).toHaveAttribute('href', '/learn/today');
    expect(today.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Yo‘l xaritasi' })[0]).toHaveAttribute('href', '/learn/roadmap');
  });

  it('WEB-SHELL-03 Roadmap is the active route on /learn/roadmap', () => {
    h.pathname = '/learn/roadmap';
    renderShell();
    expect(screen.getAllByRole('link', { name: 'Yo‘l xaritasi' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-04 all three primary items are live links — no disabled/placeholder primary nav', () => {
    const { container } = renderShell();
    expect(screen.getAllByRole('link', { name: 'Bugun' })[0]).toHaveAttribute('href', '/learn/today');
    expect(screen.getAllByRole('link', { name: 'Natijalar' })[0]).toHaveAttribute('href', '/learn/progress');
    expect(container.querySelectorAll('nav [aria-disabled="true"]').length).toBe(0);
  });

  it('WEB-SHELL-10 Results is the active route on /learn/progress', () => {
    h.pathname = '/learn/progress';
    renderShell();
    expect(screen.getAllByRole('link', { name: 'Natijalar' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-05 uses the canonical ThemeSwitcher (menu popover) and the shared language pill', () => {
    const { container } = renderShell();
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Til' })).toBeInTheDocument();
  });

  it('WEB-SHELL-06 secondary destinations (Fanlar / Profil) live in the account menu', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'Fanlar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hisob' }));
    expect(screen.getByRole('link', { name: 'Fanlar' })).toHaveAttribute('href', '/learn/subjects');
    expect(screen.getByRole('link', { name: 'Profil' })).toHaveAttribute('href', '/learn/profile');
  });

  it('WEB-SHELL-07 logout clears auth and routes to /login', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Hisob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chiqish' }));
    await waitFor(() => expect(h.logout).toHaveBeenCalled());
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/login'));
  });
});
