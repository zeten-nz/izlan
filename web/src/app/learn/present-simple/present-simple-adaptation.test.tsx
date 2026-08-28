import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import PresentSimpleRoadmapPage from './page';

const h = vi.hoisted(() => ({ intents: vi.fn(), roadmap: vi.fn(), focus: vi.fn(), startReview: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/v2-learning', () => ({ fetchV2Roadmap: h.roadmap, fetchV2Focus: h.focus, startPointReview: h.startReview }));

const INTENT = { id: 'li1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'g', title: 'General' } };
const SKILL = { id: 'sk-affirmative', name: 'Present Simple — affirmative' };

const point = (over: Record<string, unknown> = {}) => ({
  roadmapPointId: 'p1',
  pointKey: 'ENG-A1-PRESENT-SIMPLE',
  title: 'Present Simple',
  learningOutcome: { canDo: ['Habits and facts'] },
  estimatedEffortMin: 20,
  sortOrder: 100,
  availability: 'AVAILABLE',
  acquisition: 'LEARNED',
  attention: 'NONE',
  attentionReason: null,
  attentionSkill: null,
  learned: true,
  validated: false,
  activeSessionId: null,
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><PresentSimpleRoadmapPage /></I18nProvider></ThemeProvider>);
}

describe('V2 roadmap — review/repair adaptation (WEB-RA)', () => {
  beforeEach(() => {
    Object.values(h).forEach((f) => f.mockReset());
    h.intents.mockResolvedValue([INTENT]);
  });

  it('WEB-RA-01: a REPAIR point shows a strengthen badge, a plain-language reason, and routes repair into teaching', async () => {
    const p = point({ attention: 'REPAIR_REQUIRED', attentionReason: 'REPEATED_MISTAKE', attentionSkill: SKILL });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'REPAIR', policyVersion: 'v1', point: { roadmapPointId: 'p1', pointKey: 'ENG-A1-PRESENT-SIMPLE', title: 'Present Simple', activeSessionId: null }, skill: SKILL, reason: 'REPEATED_MISTAKE' });
    renderPage();

    expect(await screen.findByText('Mustahkamlash kerak')).toBeInTheDocument(); // repair badge
    // plain-language reason naming the skill (no engine terms)
    expect(screen.getAllByText(/qiynaldingiz/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Present Simple — affirmative/).length).toBeGreaterThan(0);
    // repair routes back through teaching
    const links = screen.getAllByRole('link', { name: 'Mustahkamlash' });
    expect(links[0]).toHaveAttribute('href', '/teaching/p1');
    // never leak engine codes / raw ids
    expect(document.body.textContent).not.toContain('REPEATED_MISTAKE');
    expect(document.body.textContent).not.toContain('REPAIR_REQUIRED');
    expect(document.body.textContent).not.toContain('sk-affirmative');
  });

  it('WEB-RA-02: a REVIEW_DUE point starts a point review and routes into the review runner', async () => {
    const p = point({ attention: 'REVIEW_DUE', attentionReason: 'RETENTION_DUE', attentionSkill: SKILL });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'REVIEW', policyVersion: 'v1', point: { roadmapPointId: 'p1', pointKey: 'ENG-A1-PRESENT-SIMPLE', title: 'Present Simple', activeSessionId: null }, skill: SKILL, reason: 'RETENTION_DUE' });
    h.startReview.mockResolvedValue({ id: 'rs1' });
    renderPage();

    expect(await screen.findByText('Takrorlash vaqti')).toBeInTheDocument(); // review badge
    const buttons = screen.getAllByRole('button', { name: 'Takrorlash' });
    fireEvent.click(buttons[buttons.length - 1]!); // the point-card review button
    await waitFor(() => expect(h.startReview).toHaveBeenCalledWith('p1', 'sk-affirmative'));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/review-session/rs1'));
  });

  it('WEB-RA-03: CONTINUE focus points the learner at the next teaching action', async () => {
    const p = point({ acquisition: null, learned: false, availability: 'AVAILABLE' });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'CONTINUE', policyVersion: 'v1', point: { roadmapPointId: 'p1', pointKey: 'ENG-A1-PRESENT-SIMPLE', title: 'Present Simple', activeSessionId: null }, skill: null, reason: null });
    renderPage();

    expect(await screen.findByText('Davom etamiz')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Davom etish' })).toHaveAttribute('href', '/teaching/p1');
  });

  it('WEB-RA-04: DONE focus shows an all-caught-up message (no fabricated next task)', async () => {
    const p = point({ learned: true, attention: 'NONE' });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'DONE', policyVersion: 'v1', point: null, skill: null, reason: null });
    renderPage();

    expect(await screen.findByText('Ajoyib ish!')).toBeInTheDocument();
  });
});
