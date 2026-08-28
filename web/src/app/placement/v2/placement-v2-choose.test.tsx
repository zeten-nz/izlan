import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import PlacementV2Page from './page';

const h = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), intents: vi.fn(), fromZero: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: h.push }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/placement-v2', () => ({ startFromZero: h.fromZero }));

const INTENT = { id: 'li1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };

function renderPage() {
  return render(<ThemeProvider><I18nProvider><PlacementV2Page /></I18nProvider></ThemeProvider>);
}

describe('Placement V2 — choose path (WEB-PV2C)', () => {
  beforeEach(() => {
    for (const f of [h.replace, h.push, h.intents, h.fromZero]) f.mockReset();
    h.intents.mockResolvedValue([INTENT]);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('WEB-PV2C-01 shows both honest paths with subject context', async () => {
    renderPage();
    expect(await screen.findByText('Noldan boshlayman')).toBeInTheDocument();
    expect(screen.getByText('Men allaqachon bilaman')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('WEB-PV2C-02 "start from zero" creates a FRESH_START decision then routes to the personalized roadmap', async () => {
    h.fromZero.mockResolvedValue({ decisionId: 'd1', decisionType: 'FRESH_START' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noldan boshlash' }));
    await waitFor(() => expect(h.fromZero).toHaveBeenCalledWith('s1', expect.any(String)));
    expect(h.replace).toHaveBeenCalledWith('/learn/present-simple');
  });

  it('WEB-PV2C-03 "I already know" routes into the gated (v2) diagnostic — no premature decision', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnostikani boshlash' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/placement?learningIntentId=li1&v2=1'));
    expect(h.fromZero).not.toHaveBeenCalled();
  });

  it('WEB-PV2C-04 with no learning intent it shows a calm no-path state (no fabricated start)', async () => {
    h.intents.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Yo‘nalish topilmadi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Noldan boshlash' })).toBeNull();
  });
});
