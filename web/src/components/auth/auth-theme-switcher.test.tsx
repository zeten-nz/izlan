import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { AuthThemeSwitcher } from './AuthThemeSwitcher';

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <AuthThemeSwitcher />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('AuthThemeSwitcher (WEB-THEME)', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    document.documentElement.classList.remove('dark');
  });

  it('WEB-THEME-01 exposes an accessible, keyboard-usable theme control', () => {
    renderSwitcher();
    const btn = screen.getByRole('button', { name: 'Mavzu' });
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('WEB-THEME-02 opens a 3-option menu — System / Light / Dark', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    expect(screen.getByRole('menuitemradio', { name: 'Tizim bo‘yicha' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Yorug‘' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Qorong‘i' })).toBeInTheDocument();
  });

  it('WEB-THEME-03 selecting Dark applies the app-wide dark theme via the shared ThemeProvider', async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Qorong‘i' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(localStorage.getItem('izl-theme')).toBe('dark'); // theme pref only — never auth data
  });

  it('WEB-THEME-04 selecting Light restores the light theme', async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Qorong‘i' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    fireEvent.click(screen.getByRole('button', { name: 'Mavzu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Yorug‘' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    expect(localStorage.getItem('izl-theme')).toBe('light');
  });
});
