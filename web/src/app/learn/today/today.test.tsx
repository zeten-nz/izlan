import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import TodayPage from './page';
import type { DailyView } from '@/lib/api/daily-learning';

const h = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn(), review: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/api/daily-learning', () => ({ fetchMyToday: h.fetch, generateMyToday: h.generate }));
vi.mock('@/lib/api/v2-learning', () => ({ startPointReview: h.review }));

const learnView: DailyView = {
  localDate: '2026-08-20', timezone: 'Asia/Tashkent', generationNo: 1, status: 'CURRENT', policyVersion: 'daily-learning-v1', engineVersion: 'daily-learning-v1',
  subject: { id: 'sub1', title: 'English A1' },
  mainGoal: { roadmapPointId: 'pt1', pointKey: 'K', title: 'Present Simple', estimatedEffortMin: 20, canDo: ['use it for habits'], acquired: false, availability: 'AVAILABLE', activeSessionId: null },
  action: { type: 'LEARN', point: { roadmapPointId: 'pt1', pointKey: 'K', title: 'Present Simple' }, skill: null, reason: null },
  attention: [], progress: { mainGoalDone: false, roadmapAcquired: 0, roadmapTotal: 3 }, done: false,
};

const doneView: DailyView = {
  ...learnView,
  mainGoal: { ...learnView.mainGoal!, acquired: true },
  action: { type: 'DONE', point: null, skill: null, reason: null },
  progress: { mainGoalDone: true, roadmapAcquired: 1, roadmapTotal: 3 }, done: true,
};

const resumeView: DailyView = {
  ...learnView,
  mainGoal: { ...learnView.mainGoal!, availability: 'IN_PROGRESS', activeSessionId: 'ts1' },
};

const repairView: DailyView = {
  ...learnView,
  action: { type: 'REPAIR', point: { roadmapPointId: 'pt1', pointKey: 'K', title: 'Present Simple' }, skill: { id: 's1', name: 'Word order' }, reason: 'REPEATED_MISTAKE' },
  attention: [{ roadmapPointId: 'pt1', pointKey: 'K', title: 'Present Simple', attention: 'REPAIR_REQUIRED', attentionReason: 'REPEATED_MISTAKE', attentionSkill: { id: 's1', name: 'Word order' } }],
  progress: { mainGoalDone: true, roadmapAcquired: 1, roadmapTotal: 3 }, done: false,
};

function renderPage() {
  return render(<ThemeProvider><I18nProvider><TodayPage /></I18nProvider></ThemeProvider>);
}

describe('V2 Daily Learning home (WEB-DL)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-DL-01 no plan yet → shows the plan CTA (never auto-generates on load)', async () => {
    h.fetch.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Bugungi rejani tuzish' })).toBeInTheDocument();
    expect(h.generate).not.toHaveBeenCalled(); // page load must not mutate state
  });

  it('WEB-DL-02 explicit "plan my day" generates and shows the main goal, why, effort and the LEARN action', async () => {
    h.fetch.mockResolvedValue(null);
    h.generate.mockResolvedValue(learnView);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bugungi rejani tuzish' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Bugungi asosiy maqsad')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Present Simple' })).toBeInTheDocument();
    expect(screen.getByText('Nega aynan shu?')).toBeInTheDocument(); // always explainable
    expect(screen.getByText('use it for habits')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Boshlash' });
    expect(cta).toHaveAttribute('href', '/teaching/pt1'); // routes into the REAL teaching flow
  });

  it('WEB-DL-02b an in-progress point surfaces a resume action (Continue) into the same teaching session', async () => {
    h.fetch.mockResolvedValue(resumeView);
    renderPage();
    expect(await screen.findByText('Kechagi mashg‘ulotni davom ettiring')).toBeInTheDocument(); // resume eyebrow
    const cta = screen.getByRole('link', { name: 'Davom ettirish' });
    expect(cta).toHaveAttribute('href', '/teaching/pt1'); // start-or-resume resumes the open session
  });

  it('WEB-DL-03 a completed day shows the calm DONE state (no next-point unlock)', async () => {
    h.fetch.mockResolvedValue(doneView);
    renderPage();
    expect(await screen.findByText('Bugungi reja bajarildi')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Boshlash' })).not.toBeInTheDocument();
    expect(screen.getByText('1/3 nuqta o‘zlashtirildi')).toBeInTheDocument(); // backend-authoritative progress
  });

  it('WEB-DL-04 repair outranks: the main action is repair, with an attention item and a why explanation', async () => {
    h.fetch.mockResolvedValue(repairView);
    renderPage();
    expect(await screen.findByText('Avval mustahkamlaymiz')).toBeInTheDocument();
    expect(screen.getByText('E’tibor talab qiladi')).toBeInTheDocument();
    expect(screen.getAllByText(/Word order/).length).toBeGreaterThan(0); // learner-language reason mentions the skill
    expect(screen.getAllByRole('link', { name: 'Mustahkamlash' })[0]).toHaveAttribute('href', '/teaching/pt1');
  });

  it('WEB-DL-05 renders no answer-key material anywhere', async () => {
    h.fetch.mockResolvedValue(learnView);
    renderPage();
    await screen.findByRole('heading', { name: 'Present Simple' });
    expect(document.body.textContent).not.toContain('answerKey');
    expect(document.body.textContent).not.toContain('correctOptionIds');
  });
});
