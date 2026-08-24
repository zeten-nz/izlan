import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ThemeSwitcher } from './theme-switcher';

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('ThemeSwitcher — shared (WEB-THEME-UI)', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    document.documentElement.classList.remove('dark');
  });

  it('WEB-THEME-UI-01 exposes an accessible menu trigger', () => {
    renderSwitcher();
    const btn = screen.getByRole('button', { name: 'Mavzu' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('WEB-THEME-UI-02 opens 3 options and exposes the selected one (default = System)', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    expect(screen.getByRole('menuitemradio', { name: 'Tizim bo‘yicha' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Yorug‘' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: 'Qorong‘i' })).toHaveAttribute('aria-checked', 'false');
  });

  it('WEB-THEME-UI-03 System / Light / Dark drive the shared ThemeProvider + izl-theme persistence', async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Qorong‘i' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(localStorage.getItem('izl-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Yorug‘' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    expect(localStorage.getItem('izl-theme')).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tizim bo‘yicha' }));
    expect(localStorage.getItem('izl-theme')).toBe('system');
  });
});
