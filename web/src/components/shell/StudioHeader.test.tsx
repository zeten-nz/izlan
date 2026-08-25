import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { StudioHeader, type Crumb } from './StudioHeader';

function renderHeader(props: {
  breadcrumb?: Crumb[];
  title: string;
  status?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return render(<ThemeProvider><I18nProvider><StudioHeader {...props} /></I18nProvider></ThemeProvider>);
}

describe('Content Studio header (WEB-STUDIO)', () => {
  it('WEB-STUDIO-01 renders a linked breadcrumb, the entity title, and an actions slot', () => {
    renderHeader({
      breadcrumb: [{ label: 'Fanlar', href: '/staff/content' }],
      title: 'English A1',
      status: 'DRAFT',
      actions: <button type="button">Tahrirlash</button>,
    });
    expect(screen.getByRole('heading', { name: 'English A1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument(); // breadcrumb landmark
    expect(screen.getByRole('link', { name: 'Fanlar' })).toHaveAttribute('href', '/staff/content');
    expect(screen.getByRole('button', { name: 'Tahrirlash' })).toBeInTheDocument();
  });

  it('WEB-STUDIO-02 renders meta and omits the breadcrumb landmark when none is provided', () => {
    renderHeader({ title: 'les-001', meta: <span>oxirgi yangilanish</span> });
    expect(screen.getByRole('heading', { name: 'les-001' })).toBeInTheDocument();
    expect(screen.getByText('oxirgi yangilanish')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
