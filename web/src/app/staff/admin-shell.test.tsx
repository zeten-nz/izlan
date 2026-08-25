import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { AppShell } from '@/components/shell/AppShell';
import StaffIndexPage from './page';

const h = vi.hoisted(() => ({
  authStatus: 'authenticated' as string,
  cmsStatus: 'ready' as string,
  caps: { author: true, publish: false, subjectManage: true },
  pathname: '/staff/content',
  replace: vi.fn(),
  logout: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
}));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ status: h.authStatus, logout: h.logout }) }));
vi.mock('@/lib/cms/cms-context', () => ({ useCms: () => ({ status: h.cmsStatus, capabilities: h.caps, reload: h.reload }) }));
// Focus this test on shell chrome; the child widgets have their own coverage and hit the content API.
vi.mock('@/components/shell/SubjectSwitcher', () => ({ SubjectSwitcher: () => <div data-testid="subject-switcher" /> }));
vi.mock('@/components/shell/CommandPalette', () => ({ CommandPalette: () => null }));

function renderShell() {
  return render(<ThemeProvider><I18nProvider><AppShell><p>content area</p></AppShell></I18nProvider></ThemeProvider>);
}
function renderIndex() {
  return render(<ThemeProvider><I18nProvider><StaffIndexPage /></I18nProvider></ThemeProvider>);
}

describe('Admin shell foundation (WEB-ADMIN)', () => {
  beforeEach(() => {
    h.authStatus = 'authenticated';
    h.cmsStatus = 'ready';
    h.caps = { author: true, publish: false, subjectManage: true };
    h.pathname = '/staff/content';
    h.replace.mockReset();
    h.logout.mockReset();
    h.logout.mockResolvedValue(undefined);
  });

  it('WEB-ADMIN-01 /staff while unauthenticated redirects to /staff/login', async () => {
    h.authStatus = 'unauthenticated';
    renderIndex();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/staff/login'));
  });

  it('WEB-ADMIN-02 /staff while authenticated redirects to /staff/content', async () => {
    h.authStatus = 'authenticated';
    renderIndex();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/staff/content'));
  });

  it('WEB-ADMIN-03 Content nav is a live link to /staff/content (active on that path)', () => {
    renderShell();
    const content = screen.getAllByRole('link', { name: 'Fanlar' });
    expect(content.length).toBeGreaterThan(0);
    expect(content[0]).toHaveAttribute('href', '/staff/content');
    expect(content.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('WEB-ADMIN-04 future admin items are non-navigable and clearly marked "Tez orada"', () => {
    renderShell();
    // Users / Staff&Access / Dashboard etc. are NOT links
    expect(screen.queryByRole('link', { name: 'Foydalanuvchilar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xodimlar va ruxsatlar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Boshqaruv paneli' })).toBeNull();
    // marked coming-soon (6 future destinations), and rendered aria-disabled
    expect(screen.getAllByText('Tez orada').length).toBeGreaterThanOrEqual(4);
    const dash = screen.getByText('Boshqaruv paneli');
    expect(dash.closest('[aria-disabled="true"]')).toBeTruthy();
  });

  it('WEB-ADMIN-05 Assessment is not exposed as a functional route (coming soon only)', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'Baholash' })).toBeNull();
    const assessment = screen.getByText('Baholash');
    expect(assessment.closest('[aria-disabled="true"]')).toBeTruthy();
  });

  it('WEB-ADMIN-06 Payment Operations is not wired to any backend route in this phase', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'To‘lov operatsiyalari' })).toBeNull();
    const pay = screen.getByText('To‘lov operatsiyalari');
    expect(pay.closest('[aria-disabled="true"]')).toBeTruthy();
  });

  it('WEB-ADMIN-07 the mobile menu button is an accessible drawer disclosure (aria-expanded toggles)', () => {
    renderShell();
    const menuBtn = screen.getByRole('button', { name: 'Menyuni ochish' });
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    expect(menuBtn).toHaveAttribute('aria-controls', 'staff-mobile-drawer');
    fireEvent.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('WEB-ADMIN-08 the canonical 3-way ThemeSwitcher is used (menu popover, not a 2-way toggle)', () => {
    const { container } = renderShell();
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeTruthy();
  });

  it('WEB-ADMIN-09 logout remains functional', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Chiqish' }));
    await waitFor(() => expect(h.logout).toHaveBeenCalled());
  });

  it('WEB-ADMIN-10 existing CMS capability gating is intact (chips reflect real capabilities)', () => {
    h.caps = { author: true, publish: false, subjectManage: true };
    renderShell();
    expect(screen.getByText('Muallif')).toBeInTheDocument(); // author
    expect(screen.getByText('Fan boshqaruvi')).toBeInTheDocument(); // subjectManage
    expect(screen.queryByText('Nashr')).toBeNull(); // publish=false → not shown
  });
});
