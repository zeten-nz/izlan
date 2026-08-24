import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import DashboardPage from './page';

const h = vi.hoisted(() => ({ profile: vi.fn(), status: vi.fn(), intents: vi.fn(), roadmap: vi.fn(), today: vi.fn() }));
vi.mock('@/lib/api/profile', () => ({ fetchProfile: h.profile }));
vi.mock('@/lib/api/onboarding', () => ({ fetchOnboardingStatus: h.status, fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/roadmap', () => ({ fetchActiveRoadmap: h.roadmap }));
vi.mock('@/lib/api/daily-plan', () => ({ fetchTodayPlan: h.today }));

const profile = (over = {}) => ({ id: 'u1', displayName: 'Ali', dateOfBirth: null, timezone: 'Asia/Tashkent', preferredLanguage: 'uz', onboarding: { completed: true, completedAt: 'x' }, ...over });
const intentWithTrack = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const roadmap = { id: 'r1', subjectId: 's1', trackId: 't1', status: 'ACTIVE', sourceAssessmentAttemptId: null, progress: { total: 10, completed: 3, inProgress: 1, available: 2, blocked: 0, unavailable: 4, progressBp: 3000 }, nextItemId: null, items: [] };

function renderPage() {
  return render(<ThemeProvider><I18nProvider><DashboardPage /></I18nProvider></ThemeProvider>);
}

describe('Learner dashboard (WEB-HOME)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-HOME-01 incomplete onboarding shows a continue-setup CTA', async () => {
    h.profile.mockResolvedValue(profile({ onboarding: { completed: false, completedAt: null } }));
    h.status.mockResolvedValue({ completed: false, canComplete: false, missing: ['dateOfBirth'] });
    h.intents.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Sozlashni davom ettiring')).toBeInTheDocument());
    expect(h.roadmap).not.toHaveBeenCalled(); // no roadmap read when onboarding incomplete
  });

  it('WEB-HOME-02 complete onboarding with no active roadmap shows the no-roadmap state', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intentWithTrack]);
    h.roadmap.mockResolvedValue(null); // 404 → null
    renderPage();
    await waitFor(() => expect(screen.getByText('Shaxsiy o‘qish rejangiz hali yaratilmagan.')).toBeInTheDocument());
    expect(h.today).not.toHaveBeenCalled(); // no today read without a roadmap
  });

  it('WEB-HOME-03/06 an active roadmap renders the real summary (no fabricated values)', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intentWithTrack]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText('O‘quv yo‘l xaritangiz')).toBeInTheDocument());
    // real progress from the backend (3/10), not a fabricated number
    expect(screen.getByText('Bajarildi: 3/10')).toBeInTheDocument();
  });

  it('WEB-HOME-04 a daily-plan 404 (null) is an ordinary no-plan state', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intentWithTrack]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText('Bugungi reja hali yaratilmagan.')).toBeInTheDocument());
  });

  it('WEB-HOME-05 the dashboard only READS today (never generates it)', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intentWithTrack]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue({ id: 'p1', localDate: '2026-01-01', timezone: 'Asia/Tashkent', generationNo: 1, status: 'ACTIVE', topic: { id: 'tp', title: 'Topic 1' }, done: false, progress: { total: 3, completed: 0, progressBp: 0 }, items: [{ id: 'x', kind: 'MUST_DO', itemType: 'LESSON', position: 0, state: 'AVAILABLE', lesson: { id: 'l1', title: 'Lesson 1' } }] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Bugungi reja')).toBeInTheDocument());
    expect(h.today).toHaveBeenCalledTimes(1); // exactly one READ; there is no generate call available to the page
  });
});
