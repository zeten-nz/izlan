import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { LearnerShell } from './LearnerShell';

const h = vi.hoisted(() => ({ pathname: '/learn', logout: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ logout: h.logout }) }));

function renderShell() {
  return render(<ThemeProvider><I18nProvider><LearnerShell><p>content</p></LearnerShell></I18nProvider></ThemeProvider>);
}

describe('LearnerShell (WEB-SHELL)', () => {
  beforeEach(() => { h.pathname = '/learn'; h.logout.mockReset(); h.replace.mockReset(); h.logout.mockResolvedValue(undefined); });

  it('WEB-SHELL-01 renders the five frozen primary navigation labels', () => {
    renderShell();
    for (const label of ['Bosh sahifa', 'Yo‘l xaritasi', 'O‘rganish', 'Takrorlash', 'Natijalar']) {
      expect(screen.getAllByText((c) => c.startsWith(label)).length).toBeGreaterThan(0);
    }
  });

  it('WEB-SHELL-02 Home is the active route on /learn (aria-current)', () => {
    h.pathname = '/learn';
    renderShell();
    const home = screen.getAllByRole('link', { name: 'Bosh sahifa' });
    expect(home.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
    // Roadmap is a real link (not active here)
    expect(screen.getAllByRole('link', { name: 'Yo‘l xaritasi' })[0]).toHaveAttribute('href', '/learn/roadmap');
  });

  it('WEB-SHELL-03 Roadmap is the active route on /learn/roadmap', () => {
    h.pathname = '/learn/roadmap';
    renderShell();
    const rm = screen.getAllByRole('link', { name: 'Yo‘l xaritasi' });
    expect(rm.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-04 all five primary items are now live links — no disabled/placeholder primary nav remains', () => {
    const { container } = renderShell();
    expect(screen.getAllByRole('link', { name: 'O‘rganish' })[0]).toHaveAttribute('href', '/learn/learning');
    expect(screen.getAllByRole('link', { name: 'Takrorlash' })[0]).toHaveAttribute('href', '/learn/review');
    // Natijalar is now a real link to /learn/progress (Phase 05), not an accessibly-disabled placeholder
    expect(screen.getAllByRole('link', { name: 'Natijalar' })[0]).toHaveAttribute('href', '/learn/progress');
    // no primary nav item is disabled anymore
    expect(container.querySelectorAll('nav [aria-disabled="true"]').length).toBe(0);
  });

  it('WEB-SHELL-10 Results is the active route on /learn/progress', () => {
    h.pathname = '/learn/progress';
    renderShell();
    expect(screen.getAllByRole('link', { name: 'Natijalar' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-08 Learning is the active route on /learn/learning', () => {
    h.pathname = '/learn/learning';
    renderShell();
    expect(screen.getAllByRole('link', { name: 'O‘rganish' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-09 Review is the active route on /learn/review', () => {
    h.pathname = '/learn/review';
    renderShell();
    expect(screen.getAllByRole('link', { name: 'Takrorlash' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-SHELL-05 uses the canonical ThemeSwitcher (menu popover) and the shared language pill — not the interim toggle', () => {
    const { container } = renderShell();
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeTruthy(); // ThemeSwitcher trigger
    expect(screen.getByRole('combobox', { name: 'Til' })).toBeInTheDocument(); // AuthLangPill
  });

  it('WEB-SHELL-06 secondary destinations (Fanlar / Profil) live in the account menu', () => {
    renderShell();
    // not primary nav
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
