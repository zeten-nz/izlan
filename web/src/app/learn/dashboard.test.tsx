import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import LearnEntryPage from './page';

const h = vi.hoisted(() => ({ home: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/api/learner', () => ({ fetchLearnerHome: h.home }));

const home = (stage: 'ONBOARDING' | 'PLACEMENT' | 'TODAY', over = {}) => ({ stage, onboardingCompleted: stage !== 'ONBOARDING', subject: stage === 'ONBOARDING' ? null : { id: 's1', title: 'English' }, resume: null, policyVersion: 'learner-home-v1', ...over });

function renderPage() {
  return render(<ThemeProvider><I18nProvider><LearnEntryPage /></I18nProvider></ThemeProvider>);
}

/**
 * The /learn entry is now a server-authoritative first-run ROUTER (no V1 home content). It asks the backend where
 * the learner belongs and forwards there — the same decision on first login, refresh and re-login.
 */
describe('Learner first-run router (WEB-ENTRY)', () => {
  beforeEach(() => { h.home.mockReset(); h.replace.mockReset(); });

  it('WEB-ENTRY-01 a not-onboarded learner is routed to /onboarding', async () => {
    h.home.mockResolvedValue(home('ONBOARDING'));
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
  });

  it('WEB-ENTRY-02 an onboarded-but-unplaced learner is routed to /placement/v2', async () => {
    h.home.mockResolvedValue(home('PLACEMENT'));
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/placement/v2'));
  });

  it('WEB-ENTRY-03 a placed learner is routed to the canonical Today home', async () => {
    h.home.mockResolvedValue(home('TODAY'));
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn/today'));
  });

  it('WEB-ENTRY-04 a placed learner with an open session still lands on Today (which surfaces resume)', async () => {
    h.home.mockResolvedValue(home('TODAY', { resume: { sessionId: 'ts1', pointId: 'p1', pointTitle: 'X' } }));
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn/today'));
  });

  it('WEB-ENTRY-05 a load failure surfaces a retryable error, not a wrong redirect', async () => {
    h.home.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Qayta urinish' })).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });
});
