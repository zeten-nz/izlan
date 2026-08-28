import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import PlacementV2ResultPage from './page';

const h = vi.hoisted(() => ({ finalize: vi.fn(), attemptId: 'att1' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useParams: () => ({ attemptId: h.attemptId }) }));
vi.mock('@/lib/api/placement-v2', async (orig) => ({ ...(await orig<Record<string, unknown>>()), finalizeDiagnostic: h.finalize }));

const RESULT = {
  decisionId: 'd1',
  decisionType: 'PREREQUISITE_FALLBACK',
  entryIntent: 'CLAIMS_LEVEL',
  claimedLevel: 'A1',
  demonstratedLevel: null,
  overallBp: 3846,
  recommendedStart: { roadmapPointId: 'p3', title: 'Numbers & Personal info' },
  domains: [
    { code: 'GRAMMAR', name: 'Grammar', state: 'MEASURED', bandBp: 6000 },
    { code: 'LISTENING', name: 'Listening', state: 'NOT_ASSESSED', bandBp: null },
  ],
  points: [
    { roadmapPointId: 'p1', pointKey: 'ENG-A1-GREETINGS-INTRO', title: 'Greetings & Pronouns', outcome: 'VALIDATED', bandBp: 10000 },
    { roadmapPointId: 'p3', pointKey: 'ENG-A1-PERSONAL-INFO', title: 'Numbers & Personal info', outcome: 'WEAK', bandBp: 0 },
  ],
  summary: { validatedCount: 1, weakCount: 1, availableCount: 0, unassessedCount: 0 },
  policyVersion: 'placementThresholdPolicy/v1',
};

function renderPage() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <PlacementV2ResultPage />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('Placement V2 — result (WEB-PV2R)', () => {
  beforeEach(() => {
    h.finalize.mockReset();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('WEB-PV2R-01 finalizes the diagnostic exactly once and shows the recommended start into V2 teaching', async () => {
    h.finalize.mockResolvedValue(RESULT);
    renderPage();
    expect(await screen.findByText('Tavsiya etilgan boshlanish')).toBeInTheDocument();
    await waitFor(() => expect(h.finalize).toHaveBeenCalledTimes(1));
    expect(h.finalize).toHaveBeenCalledWith('att1');
    expect(screen.getByRole('link', { name: /Shu yerdan boshlash/ })).toHaveAttribute('href', '/teaching/p3');
  });

  it('WEB-PV2R-02 renders validated + weak topic outcomes (gaps stay visible, never hidden)', async () => {
    h.finalize.mockResolvedValue(RESULT);
    renderPage();
    expect(await screen.findByText('Greetings & Pronouns')).toBeInTheDocument();
    expect(screen.getByText('Tasdiqlangan')).toBeInTheDocument(); // VALIDATED outcome badge
    expect(screen.getByText('E’tibor kerak')).toBeInTheDocument(); // WEAK outcome badge
  });

  it('WEB-PV2R-03 measured domains show a band; unassessed domains say "not assessed" — never 0%', async () => {
    h.finalize.mockResolvedValue(RESULT);
    renderPage();
    // Grammar has objective evidence → a real band (60%).
    expect(await screen.findByRole('progressbar', { name: 'Grammar' })).toHaveAttribute('aria-valuenow', '60');
    // Listening has none → honest "not assessed", and no 0% progressbar.
    expect(screen.getByText('Baholanmagan')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Listening' })).toBeNull();
    expect(screen.getByText(/0% degani emas/)).toBeInTheDocument();
  });

  it('WEB-PV2R-04 continues to Today (the hub) with a secondary route into the generic roadmap', async () => {
    h.finalize.mockResolvedValue(RESULT);
    renderPage();
    expect(await screen.findByRole('link', { name: 'Bugungi rejaga o‘tish' })).toHaveAttribute('href', '/learn/today');
    expect(screen.getByRole('link', { name: 'Yo‘l xaritamni ko‘rish' })).toHaveAttribute('href', '/learn/roadmap');
  });
});
