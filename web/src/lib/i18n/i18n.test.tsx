import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useI18n } from './i18n-context';
import uz from './messages/uz';
import ru from './messages/ru';
import en from './messages/en';
import { StatusBadge } from '@/components/ui/status-badge';
import { setAccessToken, clearAccessToken } from '@/lib/auth/token-store';

const AUTHORED_CONTENT = 'Present Simple qachon ishlatiladi?'; // authored lesson content — must NEVER be localized

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="loc">{locale}</span>
      <span data-testid="chrome">{t('common.save')}</span>
      <span data-testid="content">{AUTHORED_CONTENT}</span>
      <button onClick={() => setLocale('ru')}>ru</button>
      <button onClick={() => setLocale('en')}>en</button>
      <button onClick={() => setLocale('uz')}>uz</button>
    </div>
  );
}

beforeEach(() => {
  clearAccessToken();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('CMS i18n (uz default, ru/en switch — chrome only)', () => {
  it('I18N-01 default locale renders Uzbek UI', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('loc').textContent).toBe('uz');
    expect(screen.getByTestId('chrome').textContent).toBe(uz.common.save);
  });

  it('I18N-02 switching to Russian changes application chrome', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('chrome').textContent).toBe(uz.common.save);
    fireEvent.click(screen.getByText('ru'));
    expect(screen.getByTestId('chrome').textContent).toBe(ru.common.save);
    expect(ru.common.save).not.toBe(uz.common.save);
  });

  it('I18N-03 switching to English changes application chrome', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('en'));
    expect(screen.getByTestId('chrome').textContent).toBe(en.common.save);
  });

  it('I18N-04 switching locale does NOT mutate authored lesson content', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const before = screen.getByTestId('content').textContent;
    fireEvent.click(screen.getByText('ru'));
    fireEvent.click(screen.getByText('en'));
    expect(screen.getByTestId('content').textContent).toBe(before);
    expect(screen.getByTestId('content').textContent).toBe(AUTHORED_CONTENT);
  });

  it('I18N-05 backend enum stays constant while its display label localizes', () => {
    render(
      <I18nProvider>
        <StatusBadge status="PUBLISHED" />
        <Probe />
      </I18nProvider>,
    );
    // The label localizes; the enum value we pass ('PUBLISHED') never changes.
    expect(screen.getByText(uz.status.PUBLISHED)).toBeInTheDocument();
    fireEvent.click(screen.getByText('en'));
    expect(screen.getByText(en.status.PUBLISHED)).toBeInTheDocument();
    expect(uz.status.PUBLISHED).not.toBe(en.status.PUBLISHED);
  });

  it('I18N-06 locale persistence contains no auth token', () => {
    setAccessToken('SECRET-ACCESS-TOKEN');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('ru'));
    expect(localStorage.getItem('izl-locale')).toBe('ru');
    // No auth token leaked into locale persistence (localStorage or cookie).
    const dump = JSON.stringify(Object.entries(localStorage)) + document.cookie;
    expect(dump).not.toContain('SECRET-ACCESS-TOKEN');
  });
});
