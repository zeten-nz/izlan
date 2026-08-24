import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import LearningPage from './page';

const h = vi.hoisted(() => ({ status: vi.fn(), intents: vi.fn(), roadmap: vi.fn(), today: vi.fn(), generate: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchOnboardingStatus: h.status, fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/roadmap', () => ({ fetchActiveRoadmap: h.roadmap }));
vi.mock('@/lib/api/daily-plan', () => ({ fetchTodayPlan: h.today, generateTodayPlan: h.generate }));

const intent = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General' } };
const roadmap = { id: 'r1', subjectId: 's1', trackId: 't1', status: 'ACTIVE', sourceAssessmentAttemptId: null, progress: { total: 3, completed: 1, inProgress: 0, available: 1, blocked: 1, unavailable: 0, progressBp: 3300 }, nextItemId: null, items: [] };
const plan = (over = {}) => ({
  id: 'p1', localDate: '2026-08-25', timezone: 'Asia/Tashkent', generationNo: 1, status: 'CURRENT', topic: { id: 'tp', title: 'Introductions' }, done: false,
  progress: { total: 3, completed: 1, progressBp: 3300 },
  items: [
    { id: 'dpi-a', kind: 'MUST_DO', itemType: 'LESSON', position: 1, state: 'COMPLETED', lesson: { id: 'l1', title: 'Saying hello' } },
    { id: 'dpi-b', kind: 'RECOMMENDED', itemType: 'LESSON', position: 2, state: 'AVAILABLE', lesson: { id: 'l2', title: 'The verb to be' } },
    { id: 'dpi-c', kind: 'RECOMMENDED', itemType: 'LESSON', position: 3, state: 'BLOCKED', lesson: { id: 'l3', title: 'Pronouns' } },
    { id: 'dpi-r', kind: 'EXTRA', itemType: 'REVIEW', position: 4, state: null, lesson: { id: null, title: null }, skill: { id: 'sk1', name: 'Greetings' } },
  ],
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><LearningPage /></I18nProvider></ThemeProvider>);
}

describe('Learning landing (WEB-LEARN)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-LEARN-01 incomplete onboarding redirects to /onboarding', async () => {
    h.status.mockResolvedValue({ completed: false, canComplete: false, missing: ['dateOfBirth'] });
    h.intents.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/onboarding'));
    expect(h.roadmap).not.toHaveBeenCalled();
  });

  it('WEB-LEARN-02 no active roadmap shows the placement CTA with the real learningIntentId', async () => {
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(null);
    renderPage();
    const cta = await screen.findByRole('link', { name: 'Darajani aniqlash' });
    expect(cta).toHaveAttribute('href', '/placement?learningIntentId=i1');
    expect(h.today).not.toHaveBeenCalled();
  });

  it('WEB-LEARN-03 no plan yet shows an explicit generate action (never auto-POST); clicking POSTs once', async () => {
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue(null);
    h.generate.mockResolvedValue(plan());
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Bugungi rejani tayyorlash' });
    expect(h.generate).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('Introductions')).toBeInTheDocument());
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('WEB-LEARN-04 renders core lesson items with backend states + start links, and a review EXTRA link', async () => {
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue(plan());
    renderPage();
    await screen.findByText('Introductions');
    expect(screen.getByText('Bajarildi: 1/3')).toBeInTheDocument(); // backend progress
    // AVAILABLE → Boshlash link to the top-level runner keyed by dailyPlanItemId
    expect(screen.getByRole('link', { name: 'Boshlash' })).toHaveAttribute('href', '/lesson/dpi-b');
    // COMPLETED shows completed, not a start link
    expect(screen.getByText('Tugallandi')).toBeInTheDocument();
    // BLOCKED shows locked, no start link
    expect(screen.getByText('Bloklangan')).toBeInTheDocument();
    // review EXTRA links to the Review flow (never a fabricated state)
    expect(screen.getByRole('link', { name: 'Takrorlash' })).toHaveAttribute('href', '/learn/review');
  });

  it('WEB-LEARN-05 a completed plan shows a calm done state', async () => {
    h.status.mockResolvedValue({ completed: true, canComplete: true, missing: [] });
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap);
    h.today.mockResolvedValue(plan({ done: true, progress: { total: 3, completed: 3, progressBp: 10000 } }));
    renderPage();
    expect(await screen.findByText('Bugungi reja bajarildi')).toBeInTheDocument();
  });
});
