import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError, NetworkError } from '@/lib/api/errors';
import DashboardPage from './page';

const h = vi.hoisted(() => ({ profile: vi.fn(), status: vi.fn(), intents: vi.fn(), roadmap: vi.fn(), today: vi.fn(), generate: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/api/profile', () => ({ fetchProfile: h.profile }));
vi.mock('@/lib/api/onboarding', () => ({ fetchOnboardingStatus: h.status, fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/roadmap', () => ({ fetchActiveRoadmap: h.roadmap }));
vi.mock('@/lib/api/daily-plan', () => ({ fetchTodayPlan: h.today, generateTodayPlan: h.generate }));

const profile = (over = {}) => ({ id: 'u1', displayName: 'Ali', dateOfBirth: null, timezone: 'Asia/Tashkent', preferredLanguage: 'uz', onboarding: { completed: true, completedAt: 'x' }, ...over });
const intent = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const intent2 = { id: 'i2', subject: { id: 's2', slug: 'math', title: 'Math' }, track: { id: 't2', slug: 'algebra', title: 'Algebra' } };
const roadmap = (over = {}) => ({ id: 'r1', subjectId: 's1', trackId: 't1', status: 'ACTIVE', sourceAssessmentAttemptId: null, progress: { total: 10, completed: 3, inProgress: 1, available: 2, blocked: 0, unavailable: 4, progressBp: 3000 }, nextItemId: 'ri2', items: [{ id: 'ri1', position: 1, state: 'COMPLETED', skillId: 'sk1', lesson: { id: 'l1', title: 'Lesson 1' } }, { id: 'ri2', position: 2, state: 'AVAILABLE', skillId: 'sk2', lesson: { id: 'l2', title: 'Lesson 2' } }], ...over });
const plan = (over = {}) => ({ id: 'p1', localDate: '2026-01-01', timezone: 'Asia/Tashkent', generationNo: 1, status: 'CURRENT', topic: { id: 'tp', title: 'Topic 1' }, done: false, progress: { total: 3, completed: 0, progressBp: 0 }, items: [{ id: 'x', kind: 'MUST_DO', itemType: 'LESSON', position: 1, state: 'AVAILABLE', lesson: { id: 'l1', title: 'Lesson 1' } }], ...over });

function renderPage() {
  return render(<ThemeProvider><I18nProvider><DashboardPage /></I18nProvider></ThemeProvider>);
}

describe('Learner Home (WEB-HOME)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-HOME-01 incomplete onboarding redirects to /onboarding and never reads the roadmap', async () => {
    h.profile.mockResolvedValue(profile({ onboarding: { completed: false, completedAt: null } }));
    h.status.mockResolvedValue({ completed: false, canComplete: false, missing: ['dateOfBirth'] });
    h.intents.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
    expect(h.roadmap).not.toHaveBeenCalled();
  });

  it('WEB-HOME-02 complete onboarding with no active roadmap shows the placement CTA with the real learningIntentId', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(null); // ROADMAP_NOT_FOUND → null
    renderPage();
    const cta = await screen.findByRole('link', { name: 'Darajani aniqlash' });
    expect(cta).toHaveAttribute('href', '/placement?learningIntentId=i1');
    expect(h.today).not.toHaveBeenCalled(); // no daily-plan read without a roadmap
  });

  it('WEB-HOME-03 an active roadmap renders the real backend progress (no fabricated numbers)', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('O‘quv yo‘l xaritangiz')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument(); // progressBp 3000 → 30% (backend authority)
    expect(screen.getByText('Bajarildi: 3/10')).toBeInTheDocument();
    // next step comes from nextItemId=ri2 (Lesson 2), not from a client-side scan
    expect(screen.getByText('Lesson 2')).toBeInTheDocument();
  });

  it('WEB-HOME-04 a daily-plan 404 (null) is a generate-ready state — the page NEVER auto-generates on load', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Bugungi rejani tayyorlash' })).toBeInTheDocument();
    expect(h.today).toHaveBeenCalledTimes(1); // exactly one READ
    expect(h.generate).not.toHaveBeenCalled(); // no POST on mount
  });

  it('WEB-HOME-05 the explicit generate action POSTs once and the response becomes the state', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(null);
    h.generate.mockResolvedValue(plan({ topic: { id: 'tp', title: 'Introductions' } }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bugungi rejani tayyorlash' }));
    await waitFor(() => expect(screen.getByText('Bugungi reja')).toBeInTheDocument());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Introductions')).toBeInTheDocument(); // POST response rendered
  });

  it('WEB-HOME-06 a completed plan shows a calm done state with NO next-topic action', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(plan({ done: true, progress: { total: 3, completed: 3, progressBp: 10000 } }));
    renderPage();
    expect(await screen.findByText('Bugungi reja bajarildi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bugungi rejani tayyorlash' })).toBeNull(); // one Topic per day — no re-generate
  });

  it('WEB-HOME-07 a 409 no-executable-content is a truthful state (not a network error), and the action stays retryable', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(null);
    h.generate.mockRejectedValue(new ApiError(409, 'DAILY_PLAN_NO_EXECUTABLE_CONTENT', 'x'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bugungi rejani tayyorlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hozircha bugungi reja uchun ochiq dars yo‘q.'));
    expect(screen.getByRole('button', { name: 'Bugungi rejani tayyorlash' })).toBeInTheDocument();
  });

  it('WEB-HOME-08 a load failure is surfaced via the centralized error state (retry available)', async () => {
    h.profile.mockRejectedValue(new NetworkError());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Qayta yuklash' })).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('WEB-HOME-09 multiple intents render a subject selector (UI context only)', async () => {
    h.profile.mockResolvedValue(profile());
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent, intent2]);
    h.roadmap.mockResolvedValue(roadmap());
    h.today.mockResolvedValue(null);
    renderPage();
    const selector = await screen.findByRole('combobox', { name: 'Fan' });
    expect(selector).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Math' })).toBeInTheDocument();
  });
});
