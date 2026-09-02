import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import RoadmapPage from './page';

const h = vi.hoisted(() => ({ intents: vi.fn(), roadmap: vi.fn(), focus: vi.fn(), startReview: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }), useSearchParams: () => ({ get: () => null }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/v2-learning', () => ({ fetchV2Roadmap: h.roadmap, fetchV2Focus: h.focus, startPointReview: h.startReview }));

// A deliberately NON-pilot subject/point — proves the roadmap is data-driven, not Present-Simple-coupled.
const INTENT = { id: 'li1', subject: { id: 's-math', slug: 'math', title: 'Matematika' }, track: { id: 't1', slug: 'g', title: 'Umumiy' } };
const SKILL = { id: 'sk-fractions', name: 'Kasrlar' };

const point = (over: Record<string, unknown> = {}) => ({
  roadmapPointId: 'pt-frac',
  pointKey: 'MATH-A1-FRACTIONS',
  title: 'Oddiy kasrlar',
  learningOutcome: { canDo: ['Kasrlarni solishtirish'] },
  estimatedEffortMin: 15,
  sortOrder: 100,
  availability: 'AVAILABLE',
  acquisition: null,
  attention: 'NONE',
  attentionReason: null,
  attentionSkill: null,
  learned: false,
  validated: false,
  activeSessionId: null,
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><RoadmapPage /></I18nProvider></ThemeProvider>);
}

describe('Generic learner Roadmap (WEB-RM)', () => {
  beforeEach(() => {
    Object.values(h).forEach((f) => f.mockReset());
    h.intents.mockResolvedValue([INTENT]);
    h.focus.mockResolvedValue({ action: 'DONE', policyVersion: 'v1', point: null, skill: null, reason: null });
  });

  it('WEB-RM-01 renders multiple data-driven points and enters any point via its stable id (non-pilot subject)', async () => {
    const a = point({ roadmapPointId: 'pt-a', title: 'Oddiy kasrlar', sortOrder: 1 });
    const b = point({ roadmapPointId: 'pt-b', title: 'Kasrlarni qo‘shish', sortOrder: 2, availability: 'AVAILABLE' });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [a, b] });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Oddiy kasrlar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kasrlarni qo‘shish' })).toBeInTheDocument();
    // Any point is enterable by its stable roadmapPointId — no title/key coupling.
    const starts = screen.getAllByRole('link', { name: 'Boshlash' });
    expect(starts.some((l) => l.getAttribute('href') === '/teaching/pt-a')).toBe(true);
    expect(starts.some((l) => l.getAttribute('href') === '/teaching/pt-b')).toBe(true);
  });

  it('WEB-RM-02 a REPAIR point shows a strengthen badge + plain-language reason and routes repair into teaching', async () => {
    const p = point({ learned: true, acquisition: 'LEARNED', attention: 'REPAIR_REQUIRED', attentionReason: 'REPEATED_MISTAKE', attentionSkill: SKILL });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'REPAIR', policyVersion: 'v1', point: { roadmapPointId: 'pt-frac', pointKey: 'MATH-A1-FRACTIONS', title: 'Oddiy kasrlar', activeSessionId: null }, skill: SKILL, reason: 'REPEATED_MISTAKE' });
    renderPage();

    expect(await screen.findByText('Mustahkamlash kerak')).toBeInTheDocument();
    expect(screen.getAllByText(/qiynaldingiz/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Kasrlar/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Mustahkamlash' })[0]).toHaveAttribute('href', '/teaching/pt-frac');
    // no engine codes / raw ids leak
    expect(document.body.textContent).not.toContain('REPEATED_MISTAKE');
    expect(document.body.textContent).not.toContain('REPAIR_REQUIRED');
    expect(document.body.textContent).not.toContain('sk-fractions');
  });

  it('WEB-RM-03 a REVIEW_DUE point starts a point review and routes into the review runner', async () => {
    const p = point({ learned: true, acquisition: 'LEARNED', attention: 'REVIEW_DUE', attentionReason: 'RETENTION_DUE', attentionSkill: SKILL });
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [p] });
    h.focus.mockResolvedValue({ action: 'REVIEW', policyVersion: 'v1', point: { roadmapPointId: 'pt-frac', pointKey: 'MATH-A1-FRACTIONS', title: 'Oddiy kasrlar', activeSessionId: null }, skill: SKILL, reason: 'RETENTION_DUE' });
    h.startReview.mockResolvedValue({ id: 'rs1' });
    renderPage();

    expect(await screen.findByText('Takrorlash vaqti')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Takrorlash' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(h.startReview).toHaveBeenCalledWith('pt-frac', 'sk-fractions'));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/review-session/rs1'));
  });

  it('WEB-RM-04 DONE focus shows an all-caught-up message (no fabricated next task)', async () => {
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [point({ learned: true, acquisition: 'LEARNED' })] });
    renderPage();
    expect(await screen.findByText('Ajoyib ish!')).toBeInTheDocument();
  });

  it('WEB-RM-05 offers a link back to Today (the hub) and renders no answer-key material', async () => {
    h.roadmap.mockResolvedValue({ generation: { id: 'g1' }, points: [point()] });
    renderPage();
    await screen.findByRole('heading', { name: 'Oddiy kasrlar' });
    expect(screen.getByRole('link', { name: 'Bugungi reja' })).toHaveAttribute('href', '/learn/today');
    expect(document.body.textContent).not.toContain('answerKey');
  });
});
