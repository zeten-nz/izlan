import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { LessonActivityView } from './LessonActivityView';
import type { LearnerActivity } from '@/lib/api/types';

const mdActivity = (markdown: string, type = 'EXPLANATION'): LearnerActivity => ({ id: 'a1', type, position: 0, schemaVersion: 'lesson-activity-markdown/v1', markdown });
function renderMd(markdown: string, type = 'EXPLANATION') {
  return render(<ThemeProvider><I18nProvider><LessonActivityView activity={mdActivity(markdown, type)} /></I18nProvider></ThemeProvider>);
}

describe('LessonActivityView safe renderer (WEB-LAV)', () => {
  it('WEB-LAV-01 renders a GFM pipe table as a real table (rule card / word–meaning pairs)', () => {
    renderMd('| Olmosh | To be |\n| --- | --- |\n| I | am |\n| You / We / They | are |');
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Olmosh' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'am' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'You / We / They' })).toBeInTheDocument();
  });

  it('WEB-LAV-02 renders a blockquote as a callout note', () => {
    const { container } = renderMd("> **E'tibor bering:** he/she/it bilan **is**.");
    expect(screen.getByText(/E'tibor bering/)).toBeInTheDocument();
    expect(container.querySelector('.border-l-primary')).not.toBeNull(); // accented callout panel
  });

  it('WEB-LAV-03 renders inline `pattern` as code, and **bold** as strong', () => {
    const { container } = renderMd('Pattern: `Do + you + verb?` and **important**.');
    expect(container.querySelector('code')?.textContent).toBe('Do + you + verb?');
    expect(container.querySelector('strong')?.textContent).toBe('important');
  });

  it('WEB-LAV-04 renders a horizontal rule for section breaks', () => {
    const { container } = renderMd('Section one\n\n---\n\nSection two');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('WEB-LAV-05 NEVER injects raw HTML — tags render as literal text, no elements created (safe by construction)', () => {
    const { container } = renderMd('Danger <script>alert(1)</script> and <img src=x onerror=alert(1)> stay literal.');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<script>alert(1)</script>'); // shown as text
  });

  it('WEB-LAV-06 EXAMPLE activities render on a visually distinct surface', () => {
    const { container } = renderMd('- I **work** every day.', 'EXAMPLE');
    expect(container.querySelector('.border-l-primary')).not.toBeNull();
  });

  it('WEB-LAV-07 a metadata-only (IMAGE) activity shows a safe placeholder, not a broken element', () => {
    render(<ThemeProvider><I18nProvider><LessonActivityView activity={{ id: 'a2', type: 'IMAGE', position: 0 }} /></I18nProvider></ThemeProvider>);
    expect(screen.getByText('Bu kontent hozircha mavjud emas.')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
